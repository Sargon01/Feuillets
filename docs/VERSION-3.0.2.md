# Feuillets 3.0.2

> English: [Release 3.0.2](RELEASE-3.0.2.md) · Français · [Index de la documentation](README.md)

Feuillets 3.0.2 enrichit l’espace Recherche avec la prise en charge des pièces jointes documentaires et de l’import de fichiers, intègre les brouillons rapides dans l’arborescence des projets, et finalise l’internationalisation complète en français et en anglais.

## Recherche et gestion documentaire

- **Pièces jointes documentaires** : l’espace Recherche accueille désormais des documents de référence non Markdown aux côtés des notes : PDF, fichiers bureautiques (DOC, DOCX, ODT, RTF), tableurs (XLS, XLSX, ODS, CSV, TSV), présentations (PPT, PPTX, ODP), livres EPUB, images et schémas Excalidraw.
- **Ouverture directe** : un clic sur une pièce jointe l’ouvre directement avec les visionneuses intégrées d’Obsidian.
- **Importation et réorganisation** : des fichiers externes peuvent être importés directement dans les dossiers de Recherche, et les éléments ou sous-dossiers peuvent être réorganisés manuellement.
- **Interactions enrichies** : des actions rapides sur chaque ligne et un menu « + » facilitent la création et l’ajout de documents.

## Flux des brouillons rapides

- **Déplacer un brouillon vers un projet** : une action dédiée et une fenêtre modale permettent de transférer un brouillon directement vers le dossier ou chapitre de son choix dans le manuscrit, qu’il s’agisse du projet actif ou d’un autre projet du coffre.
- La détection de collision évite tout écrasement accidentel en numérotant automatiquement les doublons éventuels.

## Internationalisation complète français/anglais

- **Interface bilingue** : Feuillets prend en charge l’ensemble de son interface en français et en anglais, avec l’anglais comme repli technique standard.
- **Création de projet adaptée** : les nouveaux projets créent automatiquement leur arborescence et leurs noms par défaut selon la langue d’interface active (par exemple `Manuscript`, `Research`, `Characters` en anglais ; `Manuscrit`, `Recherche`, `Personnages` en français).
- **Taxonomie stable** : les statuts, étiquettes et filtres sont traduits à l’affichage tout en conservant des identifiants internes stables et indépendants de la langue.
- **Reconnaissance des projets existants** : les projets créés en français ou en anglais restent reconnus automatiquement.
- **Changement de langue sécurisé** : changer la langue d’interface dans Obsidian ne renomme aucun dossier existant du coffre et ne modifie jamais le contenu de l’utilisateur.
