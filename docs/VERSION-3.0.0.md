# Feuillets 3.0.0

> English: [Release 3.0.0](RELEASE-3.0.0.md) · Français · [Index de la documentation](README.md)

Feuillets 3.0 étend le même modèle Markdown local dans deux directions : un projet peut désormais aller du brouillon rapide à plusieurs ouvrages indépendants, et l’écriture documentaire peut utiliser des ressources BibTeX contextualisées sans faire de Zotero ou Pandoc des dépendances d’exécution.

## Brouillon, article, livre ou série

- **Nouveau brouillon rapide** crée un feuillet Markdown immédiatement éditable, hors de la compilation globale tant qu’il n’a pas rejoint le Classeur.
- Un gabarit de document simple accompagne les textes autonomes et les exports légers.
- Tout dossier du Classeur peut rester un espace ordinaire ou être défini comme **ouvrage** indépendant.
- Un ouvrage possède sa propre frontière éditoriale et peut hériter de la Composition ou la personnaliser.
- Plusieurs ouvrages dans un projet peuvent représenter une trilogie, un recueil, des modules de cours ou des articles indépendants tout en partageant les éléments communs du projet.

## Portées et composition fiabilisées

- Les portées dossier, feuillet, sélection, ouvrage et projet complet suivent désormais le même modèle de compilation.
- L’Aperçu et l’export suivent la même traversée des chapitres imbriqués et les mêmes séparateurs de scènes.
- Les brouillons sont exclus de la compilation globale jusqu’à leur déplacement dans le manuscrit, mais restent exportables directement.
- Les projets portables `.feuil` conservent les ouvrages imbriqués et leurs réglages locaux de composition pris en charge.

## Recherche contextualisée

- La Recherche suit la branche physique des ancêtres du feuillet actif, dans la limite de l’espace courant.
- Les associations directes du feuillet et celles des dossiers intermédiaires restent accessibles.
- Les branches sœurs ou extérieures ne fuient pas dans le contexte actif.
- Les noms des dossiers Recherche suivent la langue active de l’interface.

## Flux BibTeX

- Un espace peut choisir un fichier `.bib` et un style CSL facultatif dans son dossier Recherche associé.
- La saisie de `[@` ouvre un sélecteur filtrable par citekey, auteur, titre et année.
- Le sélecteur prend en charge plusieurs références et les localisateurs de page.
- L’Aperçu résout les citations sans imposer l’isolation préalable du dossier dans le Classeur.
- Le panneau Recherche affiche les entrées BibTeX citées, leur nombre d’occurrences et les clés inconnues.
- Feuillets peut générer une bibliographie Markdown simple à partir des entrées BibTeX citées et des fiches Source existantes.
- Les exports natifs conservent les citekeys Pandoc dans le manuscrit.

## Paquet Pandoc portable

Le nouvel export **Paquet Pandoc (.zip)** contient le `manuscript.md` compilé, un `pandoc.yaml` portable, les bibliographies requises, le CSL applicable, les médias locaux et un rapport uniquement lorsqu’un problème doit être signalé. Il détecte les citekeys définies dans plusieurs bibliographies incluses et n’écrit aucun paquet partiel en cas de conflit.

Feuillets n’installe, ne recherche et n’exécute ni Pandoc, ni Zotero, ni Better BibTeX. Le paquet reste un pont facultatif vers un flux de publication universitaire géré par l’utilisateur.

## Compatibilité

Les projets Markdown existants, l’usage historique « un projet = un manuscrit », les formats d’export natifs et les anciens chemins Recherche restent pris en charge. Aucun exécutable externe ni compte n’est requis pour le fonctionnement natif de Feuillets.
