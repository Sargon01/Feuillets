# Note de maintenance documentaire — Feuillets 2.5

Cette page évite que les prochains correctifs réintroduisent dans la documentation des concepts supprimés pendant le chantier 2.5.

## Terminologie publique actuelle

- **Classeur** : navigation/manipulation du manuscrit.
- **Double vue** : volet gauche Manuscrit + Coffre, Classeur inchangé à droite.
- **Plan** : vue tabulaire de la structure et des métadonnées.
- **Continu** : manuscrit composite éditable en mémoire, fichiers sources séparés.
- **Aperçu** : document paginé/composé.
- **Feuillet / Recherche / Journal / Projet / Relecture** : cinq onglets du panneau droit.
- **Édition** : surface centrale, seulement Composition et Mise en page.
- **Exporter** : action de la barre d’Édition, pas troisième mode.

## Concepts à ne plus documenter comme actuels

- Édition comme onglet de l’Inspecteur ;
- onglet public Analyse séparé ;
- onglet public Notes : le libellé est **Feuillet** ;
- Révision DOCX sous Édition ;
- Composition/Mise en page/Export comme trois onglets centraux ;
- Première page à la fois dans Composition et Mise en page ;
- export rapide depuis le Classeur (retiré au profit de Double vue) ;
- dépendance à un dossier Recherche imposé pour utiliser une documentation existante ;
- ordre Scrivener laissé au tri alphabétique du coffre.

## Distinguer les outils de réécriture

Ne pas utiliser « annotation » comme terme générique pour tous les retours.

- **Annotation de travail** : remarque personnelle, hors Markdown.
- **Comparaison/version** : deux états d’un texte.
- **Relecture collaborative** : session auteur/relecteur et paquet `.feuillets`.
- **Révision DOCX** : retour provenant de Word.

## Données utilisateur et i18n

Une chaîne UI doit être traduite ; un nom de fichier/dossier existant ne doit pas être renommé parce que la locale change. Les noms canoniques de certains documents/dossiers sur disque peuvent être indépendants de la langue visible.

## Documentation et releases

Avant chaque release majeure :

1. comparer le dernier tag publié au `main` final ;
2. regrouper les commits par comportement final ;
3. mettre à jour les deux langues ;
4. chercher les anciens chemins UI dans tous les `.md` ;
5. vérifier les captures ;
6. seulement ensuite écrire les notes de release.
