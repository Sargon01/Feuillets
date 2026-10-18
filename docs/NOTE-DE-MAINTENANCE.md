# Note de maintenance documentaire — Feuillets

Cette page évite que les prochains correctifs réintroduisent dans la documentation des concepts supprimés ou déplacés pendant les chantiers récents.

## Terminologie publique actuelle

- **Classeur** : navigation/manipulation du manuscrit.
- **Double vue** : navigation gauche Manuscrit + Recherche + Espaces + Coffre, Classeur de travail à droite reflétant l’espace actif.
- **Plan** : vue tabulaire de la structure et des métadonnées.
- **Continu** : manuscrit composite éditable en mémoire, fichiers sources séparés.
- **Aperçu** : document paginé/composé.
- **Feuillet / Recherche / Journal / Édition / Statistiques / Relecture / Carnets** : sept onglets publics du panneau Feuillets.
- **Édition** : onglet du panneau contenant Composition, Mise en page et documents éditoriaux.
- **Exporter** : action de la barre d’Édition, pas troisième mode.

## Stabilisation de l’interface

La géographie principale décrite ci-dessus constitue un **contrat d’interface**.

- Les correctifs et améliorations locales ne doivent plus déplacer une fonction majeure vers une autre zone de l’application.
- Les prochaines évolutions privilégient la lisibilité, la découvrabilité, l’ergonomie locale, les performances et la fiabilité.
- Une réorganisation globale de l’interface ne doit être envisagée que pour résoudre un problème utilisateur démontré, et non pour une simple préférence d’organisation.
- La stabilité de l’emplacement des fonctions est désormais considérée comme une qualité du produit et un enjeu de non-régression documentaire.

## Concepts à ne plus documenter comme actuels

- Projet comme onglet public de configuration ; la gestion du projet se fait depuis **Gérer les projets…** ;
- onglet public Analyse séparé ;
- onglet public Notes : le libellé est **Feuillet** ;
- Révision DOCX dans Édition ou dans un ancien panneau autonome : l’entrée actuelle est **Relecture → Révision DOCX**, également accessible par **Ouvrir Relecture — Révision DOCX** ;
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

## Repères pour la documentation 3.7

- Le Carnet est un atelier visuel majeur ; distinguer notes libres, cartes de fichiers et blocs structurés.
- L’inspecteur modifie la sélection actuelle ; les styles par défaut concernent les futures cartes et connexions libres.
- Empiler les notes est ponctuel ; Empiler dynamiquement conserve une relation persistante.
- `openVisualOutline()` cible le Carnet global et le manuscrit entier. Ne pas déduire la portée de la commande des seuls anciens modèles de Plans de dossier.
- Les références croisées internes restent distinctes des citations bibliographiques CSL et des wikiliens de navigation.
- Les notes de version et rapports de validation datés sont des archives. Les guides actuels priment pour décrire l’interface.

Voir [la traçabilité de l’audit 3.7](validation/documentation-3.7-audit.md).
