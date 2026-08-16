# Créer une interface d’écriture épurée

> **Français** · [English](WRITING-INTERFACE.md) · [Index](README.md)

Feuillets peut rendre Obsidian plus calme pour l’écriture sans imposer un thème ni enfermer le projet dans une interface propriétaire.

![Mode Concentration](feuillets-concentration.png)

## Trois niveaux différents

### L’éditeur

Le texte reste dans l’éditeur Markdown natif d’Obsidian. Feuillets peut appliquer au manuscrit sa présentation d’écriture : largeur, typographie, alinéas, interligne et aides de saisie.

### L’atelier

Autour du texte, Feuillets ajoute les surfaces spécialisées : **Classeur**, **Cartes/Plan**, **Continu**, **Aperçu**, panneau droit et **Édition**.

### Concentration

Le mode **Concentration** réduit temporairement l’environnement autour du texte sans modifier le fichier.

## Le Classeur

Le Classeur 2.5 peut rester très sobre. Sa vue simple donne toute la largeur à la navigation du manuscrit. La **double vue** ajoute uniquement un navigateur à gauche :

- **Manuscrit** pour voir les dossiers et la hiérarchie d’un coup d’œil ;
- **Coffre** pour consulter d’autres documents du vault sans quitter Feuillets.

Le volet droit reste le même Classeur. La zone Coffre est volontairement en lecture/navigation seule et ne remplace pas l’Explorateur de fichiers d’Obsidian.

Voir [Classeur et navigation](CLASSEUR-ET-NAVIGATION.md).

## Le panneau droit

Le panneau Feuillets réunit cinq onglets publics :

- **Feuillet** — synopsis/résumé, notes, propriétés, annotations, notes de bas de page et Contexte ;
- **Recherche** — documentation, Sources/Bibliographie et dossiers associés ;
- **Journal** — journal d’écriture et suivi ;
- **Projet** — informations et réglages propres au projet ;
- **Relecture** — analyse de texte, relecture collaborative, Révision DOCX et comparaison.

**Édition** n’est plus un onglet latéral. C’est une surface centrale pour **Composition** et **Mise en page**.

## Écrire plusieurs feuillets

Le mode **Continu** remplace le besoin d’ouvrir des dizaines d’onglets pour écrire un chapitre ou un manuscrit. Plusieurs feuillets apparaissent dans un seul éditeur, tout en restant des fichiers Markdown séparés.

## Écrire et relire côte à côte

![Écriture et aperçu](feuillets-concentration-apercu.png)

L’**Aperçu** peut rester à côté du texte pour relire la composition paginée. Un document du Coffre ou une fiche Recherche externe peut également être ouvert **côte à côte** sans être intégré au manuscrit.

## Réglages de l’interface

Les réglages Feuillets permettent notamment d’ajuster la présentation d’écriture, la largeur du texte et certains éléments de l’interface. Les valeurs suggérées restent un point de départ, jamais un verrou.

## Concentration

Concentration peut réduire les panneaux, recentrer la colonne, utiliser une largeur propre, maintenir la zone active à une position stable et estomper le texte environnant. Aucun de ces effets n’est écrit dans le Markdown.

## Thèmes et extraits CSS

Feuillets ne remplace pas le thème complet d’Obsidian. Pour changer le fond global du coffre ou d’autres variables d’apparence, utilisez un thème ou un extrait CSS Obsidian.

```css
.theme-light {
  --background-primary: #f3eee0;
  --background-primary-alt: #f3eee0;
  --background-secondary: #ece4d0;
}
```

## Modules facultatifs

Aucun module supplémentaire n’est requis pour le cœur de Feuillets.

- **Advanced Canvas** peut enrichir le Carnet ;
- **Feuillets-Grammalecte** peut fournir une analyse linguistique française ;
- **Courrier** peut compléter le suivi éditorial.

## Principe général

La bonne interface Feuillets n’est pas celle qui montre tous les outils à la fois. Le texte reste au centre ; les surfaces apparaissent quand leur fonction devient utile.
