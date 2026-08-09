# Créer une interface d’écriture épurée

> **Français** · [English](WRITING-INTERFACE.md) · [Index](README.md)

Feuillets peut rendre Obsidian beaucoup plus calme pour l’écriture sans imposer un thème ni modifier le reste du coffre de façon irréversible.

![Mode Concentration](feuillets-concentration.png)

## 1. Distinguer trois niveaux

### L’éditeur

C’est l’éditeur Markdown natif d’Obsidian. Feuillets applique au manuscrit sa présentation d’écriture.

### L’atelier

Classeur à gauche, Inspecteur à droite, onglets et commandes de Feuillets.

### Concentration

Un état temporaire qui réduit l’environnement autour du texte.

Cette distinction évite de chercher un unique « mode écriture » qui devrait tout faire à la fois.

## 2. Réglages de l’interface

Ouvrez :

> **Réglages → Feuillets → Interface**

Vous pouvez notamment ajuster :

- police ;
- taille ;
- interligne ;
- largeur du texte ;
- couleur d’accent ;
- transparence de certains panneaux ;
- visibilité de plusieurs éléments d’Obsidian ;
- discrétion des actions secondaires.

Le bouton de valeurs suggérées fournit un point de départ ; il ne verrouille aucun réglage.

## 3. Le Classeur peut rester très léger

Le Classeur peut afficher uniquement les noms, ou ajouter progressivement :

- liseré de label ;
- tags ;
- statut ;
- progression ;
- nombre de mots ;
- extrait/synopsis/résumé/notes.

Si la structure vous suffit, laissez ces informations masquées.

## 4. L’Inspecteur est modulaire

Les six onglets sont :

- Notes ;
- Recherche ;
- Journal ;
- Édition ;
- Analyse ;
- Relecture.

Masquez les onglets que vous n’utilisez pas. Le Classeur reste indépendant : cacher ou fermer l’Inspecteur ne supprime pas la navigation du manuscrit.

## 5. Concentration

Le mode Concentration peut :

- masquer les panneaux ;
- recentrer la colonne ;
- utiliser une largeur propre ;
- garder la zone active dans une position de type machine à écrire ;
- estomper la ligne ou le paragraphe non actif ;
- afficher le compteur.

Il n’ajoute rien au fichier et ne crée aucune copie du texte.

## 6. Écrire et relire côte à côte

![Écriture et aperçu](feuillets-concentration-apercu.png)

L’Aperçu peut rester ouvert à côté du feuillet pour contrôler le rythme d’un chapitre ou le rendu paginé sans transformer l’éditeur en logiciel de PAO.

## 7. Thèmes et extraits CSS

Feuillets n’essaie pas de remplacer le thème complet d’Obsidian. Si vous voulez changer le fond global du coffre, utilisez un thème ou un extrait CSS.

Exemple minimal :

```css
.theme-light {
  --background-primary: #f3eee0;
  --background-primary-alt: #f3eee0;
  --background-secondary: #ece4d0;
}
```

Placez l’extrait dans `.obsidian/snippets/` puis activez-le dans **Réglages → Apparence → Extraits CSS**.

## 8. Modules facultatifs

Aucun module supplémentaire n’est requis pour écrire.

- **Advanced Canvas** enrichit facultativement le Carnet.
- **Feuillets-Grammalecte** ajoute l’analyse linguistique française.
- **Courrier** ajoute le suivi éditorial.

Les thèmes Minimal et les outils de personnalisation d’Obsidian peuvent être utilisés, mais Feuillets ne les exige pas.

## 9. Transporter ses réglages

Les réglages Feuillets peuvent être exportés/importés depuis les commandes prévues. Un éventuel extrait CSS reste un fichier Obsidian séparé et doit être copié séparément.
