# Créer une interface d’écriture épurée

> **Français** · [English](WRITING-INTERFACE.md)

Feuillets peut donner à Obsidian l’apparence calme d’une application d’écriture dédiée sans imposer un thème ni verrouiller les choix de l’utilisateur.

## 1. Commencer par les valeurs suggérées

Ouvrez :

> **Réglages → Feuillets → Interface**

Dans la section **Interface épurée**, le bouton **Valeurs suggérées** applique un point de départ cohérent.

Ces valeurs restent modifiables. Le bouton ne crée pas un mode fermé et ne bloque aucun réglage.

Il peut notamment agir sur :

- l’affichage des propriétés dans l’éditeur ;
- le titre intégré du feuillet ;
- la barre de titre des onglets ;
- le ruban d’icônes ;
- le sélecteur de coffre ;
- la transparence des panneaux ;
- la transparence de la barre d’onglets ;
- la discrétion des icônes d’actions ;
- la présentation des onglets latéraux inactifs.

<!-- CAPTURE RÉGLAGES
Montrer l’onglet Interface et le bouton Valeurs suggérées.
Légende : « Un clic pour retrouver un atelier calme. »
-->

## 2. Régler le confort d’écriture

La section Interface permet aussi de choisir :

- taille du texte ;
- échelle de l’interface Feuillets ;
- interligne ;
- largeur de la colonne ;
- police principale ;
- police à chasse fixe ;
- couleur d’accent.

La présentation littéraire s’applique au manuscrit. Les notes extérieures conservent une apparence plus documentaire.

## 3. Distinguer vue Écriture et Concentration

### Vue Écriture

Elle façonne la page :

- syntaxe discrète ;
- alinéas ;
- paragraphes ;
- largeur ;
- typographie.

### Mode Concentration

Il réduit l’environnement :

- panneaux masqués ;
- texte recentré ;
- ligne active maintenue au centre ;
- texte hors attention estompé ;
- compteur de mots flottant.

Les deux fonctions sont complémentaires.

## 4. Choisir éventuellement un fond ou un thème

Feuillets ne remplace pas le thème complet d’Obsidian.

Une couleur de fond personnalisée dépend du thème ou d’un extrait CSS. Cette séparation est volontaire : Feuillets règle son atelier, mais ne modifie pas l’apparence générale des autres modules.

Exemple de fond chaud :

```css
.theme-light {
  --background-primary: #f3eee0;
  --background-primary-alt: #f3eee0;
  --background-secondary: #ece4d0;
  --background-secondary-alt: #ece4d0;
}
```

Placez cet extrait dans `.obsidian/snippets/`, puis activez-le dans :

> **Réglages → Apparence → Extraits CSS**

## 5. Modules et thèmes facultatifs

Rien d’autre n’est nécessaire pour obtenir une interface épurée.

Des thèmes ou modules comme Minimal, Style Settings ou Hider peuvent être ajoutés pour une personnalisation plus poussée, mais ils ne sont pas requis par Feuillets.

## 6. Transporter son atelier

Les réglages de Feuillets peuvent être exportés puis réimportés depuis la palette de commandes.

Un extrait CSS éventuel doit être copié séparément dans le nouveau coffre.
