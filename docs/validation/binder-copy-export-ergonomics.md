# Binder : copie structurée et enregistrement des exports

## Audit

1. Le menu de la racine du projet ne proposait aucune copie. Il appelle désormais `copyScopeContents()` avec une portée `project`.
2. `showFileContextMenu()` excluait la copie lorsque `isGroup` était vrai. La copie construit maintenant une portée `selection` avec tous les chemins sélectionnés, dossiers compris. Le menu d'un dossier sélectionné applique la même règle. Le résolveur existant conserve l'ordre du Binder et déduplique les descendants ; aucun nouvel état de sélection n'est ajouté.
3. Le champ du panneau Export modifiait le preset ou `compileFileName`, tandis que les écritures imposaient le dossier de sortie et pouvaient modifier un fichier existant. Le choix ponctuel du nom et du dossier est désormais centralisé et indépendant de la composition. La découverte du dossier proposé est en lecture seule.
4. Les succès étaient annoncés par du texte sans accès direct au fichier. Le workflow présente désormais une notification commune avec deux boutons, à partir du chemin retourné par l'écriture terminée.

## Fonctionnement et limites

- `runExportWorkflow()` est partagé par le Binder, Aperçu, Édition et les commandes d'export du plugin.
- La boîte d'enregistrement Obsidian propose le nom existant, corrige l'extension du format, permet de choisir un dossier du coffre avec autocomplétion et de créer un dossier au moment de l'écriture. Le dernier dossier utilisé avec succès est mémorisé dans `lastExportFolder`.
- Les caractères interdits, les chemins traversant `..`, les noms réservés et les collisions de fichiers (y compris de casse) sont refusés. Une collision demande de choisir un autre nom ; aucun remplacement n'est proposé. L'écriture utilise `Vault.create()` / `createBinary()`, jamais `modify()`.
- Markdown est compilé en mémoire avant l'écriture choisie. DOCX, EPUB, ODT et ZIP Pandoc conservent leur moteur et utilisent le même service d'écriture. Aucun manuscrit intermédiaire n'est créé par ces exports.
- Les exports DOCX à emplacement imposé conservent leur comportement et leur nom unique, sans nouvelle boîte d'enregistrement.
- La destination libre est un emplacement **dans le coffre**. Aucun dialogue natif n'est imposé : l'API publique Obsidian ne fournit pas de boîte d'enregistrement, et aucune dépendance à un pont Electron privé n'est introduite. Le [dialogue Electron](https://www.electronjs.org/docs/latest/api/dialog) appartient au processus principal.
- Sur ordinateur, le module optionnel [Electron shell](https://www.electronjs.org/docs/latest/api/shell) ouvre l'application par défaut ou révèle le fichier dans Finder/Explorateur. Le chemin absolu provient de l'adaptateur du coffre. Sans ce module, l'ouverture passe par Obsidian ; la révélation utilise son explorateur lorsqu'il expose cette capacité. Sinon, une petite boîte affiche le chemin exact avec « Copier le chemin ».
- Le PDF conserve uniquement l'impression système. L'export ne connaît pas le chemin enregistré par ce dialogue : aucune notification d'accès à un prétendu fichier n'est ajoutée.
- Une lecture de feuillet défaillante abandonne la copie entière avant toute écriture dans le presse-papiers. Les projets et dossiers vides ne changent pas le presse-papiers.

## Fichiers concernés

| Zone | Fichiers |
| --- | --- |
| Copie et menus | `src/services/scrivenings-clipboard-source.ts`, `src/views/base-feuillets-view.ts`, `src/views/feuillets-view.ts` |
| Enregistrement et résultat | `src/services/export-destination.ts` (nouveau), `src/services/export-result.ts` (nouveau), `src/ui/export-destination-modal.ts` (nouveau) |
| Orchestration et points d'entrée | `src/services/export-workflow.ts`, `src/services/compile-export.ts`, `src/main.ts`, `src/ui/export-panel.ts`, `src/ui/export-modal.ts` |
| Préférence et traductions | `src/types.d.ts`, `src/i18n/fr.ts`, `src/i18n/en.ts` |
| Tests | `test/binder-copy-file-contents.test.js`, `test/binder-copy-folder-contents.test.js`, `test/export-destination.test.js` (nouveau), `test/export-workflow.test.js` |
| Intégration des points d'entrée | `test/binder-continu-menu.test.js`, `test/export-panel.test.js`, `test/preview-view.test.js`, `test/helpers/export-interactions.js` (nouveau) |

Les tests d'intégration acceptent explicitement la proposition de sauvegarde via une interaction déterministe. Les tests du nouveau dialogue exécutent ses champs et son bouton Enregistrer, vérifient l'annulation et le maintien du dialogue en cas de collision. Les assertions existantes sur les écritures et les portées restent actives.

## Résultats automatisés

- `npm test` : **8 758 réussis, 0 échec, 19 ignorés**, sur 8 777 tests. Les tests navigateur ont été exécutés avec Chromium hors du bac à sable après le blocage initial de son lancement. Aucun nouveau test n'est ignoré.
- `npm run build` : réussi (TypeScript et bundle de production).
- `npm run lint:obsidian` : réussi, sans avertissement.
- `npm run lint` : réussi ; 30 avertissements dans des fichiers préexistants non modifiés, aucune erreur.
- `git diff --check` : réussi.

Les contrôles ciblés couvrent la copie individuelle, les sélections contiguës/non contiguës/inversées, Maj+clic, les dossiers et descendants dédupliqués, les deux types de projet, les dossiers techniques, les contenus vides et les échecs de lecture/presse-papiers. Les contrôles d'export couvrent le dialogue Obsidian, tous les formats du workflow, les chemins effectivement retournés, les collisions et courses à l'écriture, l'annulation, la conservation de la composition, la mémoire du dossier, les actions système et leurs replis, le PDF et les DOCX à emplacement imposé.

## Vérifications manuelles dans Obsidian

Ces vérifications restent à effectuer dans l'application réelle ; les interactions Finder/Explorateur sont simulées dans les tests automatisés.

1. Sur un projet structuré puis sur un dossier existant, clic droit sur le nom du projet → **Copier le contenu**. Coller dans un éditeur texte : vérifier l'ordre, les titres et l'absence des dossiers techniques. Aucun onglet Continu/Aperçu ne doit s'ouvrir et aucun fichier ne doit apparaître.
2. Copier un feuillet, puis deux voisins, puis deux feuillets éloignés choisis dans l'ordre inverse. Vérifier les contenus exacts et leur ordre dans le texte collé. Faire aussi une sélection par Maj+clic.
3. Sélectionner un dossier et son descendant, puis un autre feuillet. Faire le clic droit successivement sur le dossier et sur un feuillet de la sélection : la sélection doit rester visible et chaque feuillet doit apparaître une seule fois dans le texte copié. Cliquer droit hors sélection doit retrouver le ciblage individuel habituel.
4. Depuis le Binder, Aperçu et Édition, exporter en Markdown, DOCX, EPUB, ODT et archive Pandoc ZIP. Choisir `Bozlak - Version éditeur` dans un dossier du coffre différent du dossier proposé. Vérifier l'extension, l'existence du seul fichier demandé et l'absence de changement du nom de compilation ou de la composition. Décompresser le ZIP et ouvrir les formats dans leurs applications habituelles.
5. Exporter de nouveau : le dernier dossier réussi doit être proposé. Choisir un nom existant, puis une variante qui ne diffère que par la casse : un message doit empêcher l'écrasement. Corriger le nom et réessayer. Tester aussi un caractère interdit et un dossier contenant `..`.
6. Annuler la boîte, y compris avec Échap ou la croix : aucun export ni dossier de destination saisi ne doit être créé et aucune action de succès ne doit apparaître.
7. Après un succès, utiliser **Ouvrir** puis **Afficher dans le dossier** : vérifier le fichier exact dans l'application par défaut et Finder/Explorateur. Déplacer ou supprimer ensuite le fichier et vérifier que les anciennes actions signalent son absence.
8. Sur mobile ou sans pont système, vérifier le choix d'un dossier du coffre et les replis Obsidian. Si l'explorateur ne permet pas la révélation, vérifier l'affichage et la copie du chemin exact.
9. Exporter en PDF et annuler l'impression : une seule boîte d'impression système, aucune boîte de sauvegarde Feuillets supplémentaire et aucune action vers un fichier supposé.
10. Lancer un export DOCX de soumission à emplacement imposé : aucun nouveau dialogue, dossier imposé conservé, fichier précédent préservé.

Aucune version, release, publication, opération de commit ou de push n'est incluse.
