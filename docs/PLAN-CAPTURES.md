# Inventaire et plan des captures

Les captures documentaires vivent toutes directement dans `docs/`.

Elles ne doivent pas être dupliquées entre la documentation française et anglaise.

## Inventaire actuel

| Fichier | Sujet | Emplacements recommandés |
|---|---|---|
| `feuillets-ecriture-apercu.png` | Classeur + écriture + Aperçu | README FR/EN, Découvrir, index docs, guide Contexte |
| `creer-premier-projet.gif` | Création d’un projet | README FR/EN, Découvrir, Parcours auteur |
| `feuillets-classeur.png` | Structure du manuscrit | README FR/EN, Découvrir, Parcours |
| `feuillets-concentration.png` | Mode Concentration | README FR/EN, Découvrir, Interface |
| `feuillets-concentration-apercu.png` | Écriture et lecture côte à côte | Interface, Parcours, Composition, guide Ulysses |
| `feuillets-apercu.png` | Aperçu paginé | README FR/EN, Découvrir, Parcours, Composition |
| `feuillets-mosaique-narrative.png` | Cartes / Plan / Chemin de fer / Chronologie | README FR/EN, Découvrir, Parcours, fonctionnalités, guides de migration |
| `feuillets-comparaison.png` | Comparaison de deux états | README FR/EN, Parcours, versionnage, guide Scrivener |
| `feuillets-import-scrivener.png` | Import Scrivener | README FR/EN, guides d’import/migration |
| `feuillets-ecosysteme.png` | Feuillets + compagnons | README FR/EN |

## Règles

1. Garder une seule copie de chaque image.
2. Utiliser des chemins relatifs depuis les fichiers de `docs/`.
3. Depuis les README racine, utiliser `docs/<nom>`.
4. Utiliser la même capture dans les pages FR et EN lorsqu’elle illustre le même concept.
5. Une capture doit expliquer un bénéfice ou une interaction, pas simplement remplir la page.
6. Masquer toute donnée personnelle.
7. Utiliser un projet de démonstration cohérent d’une image à l’autre.
8. Ne pas afficher de panneau devenu obsolète.

## Remplacer une capture

Lorsque l’interface change mais que le rôle documentaire de l’image reste le même, remplacer le fichier **en conservant son nom**.

Exemple :

```text
docs/feuillets-classeur.png
```

peut être remplacé par une capture plus récente du Classeur sans modifier tous les guides.

Changer le nom uniquement si le concept illustré change réellement.

## Images prioritaires à maintenir à jour

### `feuillets-ecriture-apercu.png`

Image principale du produit. Elle doit montrer :

- Classeur lisible ;
- feuillet actif ;
- Aperçu cohérent ;
- interface sans données privées.

### `feuillets-classeur.png`

Doit refléter le Classeur actuel : arborescence, indentation, icônes et structure cohérente.

### `feuillets-mosaique-narrative.png`

Doit présenter les quatre représentations actuelles :

- Cartes ;
- Plan ;
- Chemin de fer ;
- Chronologie.

### `feuillets-apercu.png`

Doit refléter l’Aperçu paginé actuel et, si possible, la barre d’outils/export actuelle.

### `feuillets-concentration.png`

Doit rester très lisible et ne montrer que ce que Concentration cherche précisément à faire disparaître.

## Captures qui ne sont plus nécessaires

Ne pas recréer des captures séparées d’anciens panneaux Notes, Recherche, Projet ou Révision comme s’ils étaient encore chacun une barre latérale indépendante.

Si une nouvelle capture de l’Inspecteur est ajoutée un jour, elle doit représenter **l’Inspecteur unifié à onglets**.
