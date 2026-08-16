# Remplacer Aeon Timeline par Feuillets

> **Français** · [English](REPLACE-AEON-TIMELINE-WITH-FEUILLETS.md) · [Index](README.md)

Vous utilisez Aeon Timeline pour suivre les événements, personnages, âges, fils narratifs et l’écart entre ordre chronologique et ordre du récit. Feuillets couvre une grande partie de ce travail **lorsqu’il est directement lié à un manuscrit**, mais ne cherche pas à remplacer tout le modèle temporel spécialisé d’Aeon.

![Cartes, Plan, Chemin de fer et Chronologie](feuillets-mosaique-narrative.png)

Aeon part de la chronologie et des entités. Feuillets part du texte : la Chronologie, le Chemin de fer, la Recherche et le Contexte sont des projections du même projet Markdown.

---

## 1. Retrouver la Timeline View

Dans Feuillets, utilisez **Chronologie**.

Elle peut confronter :

- scènes datées du manuscrit ;
- événements de Recherche ;
- jalons ;
- dates disponibles ;
- personnages, lieux, tags ou fils associés ;
- ordre chronologique et ordre narratif.

Une scène visible dans Chronologie reste le même fichier Markdown que celui écrit dans le Classeur ou en Continu.

---

## 2. Représenter un événement

Un événement peut être :

### une scène du manuscrit

```yaml
---
date: 1826-06-15
personnages:
  - Kali
lieu: Suvasa
fil:
  - attaque-du-tekke
---
```

### une fiche Recherche

Un événement historique ou narratif peut exister sans être raconté comme scène. Il reste alors dans Recherche et peut alimenter la Chronologie ou le Contexte.

Cette distinction sépare **ce qui arrive** de **ce que le lecteur voit dans le manuscrit**.

---

## 3. Retrouver les entités

Personnages, lieux, événements et autres éléments documentaires vivent dans **Recherche** sous forme de fichiers Markdown.

Vous pouvez aussi associer à un feuillet ou à un dossier du manuscrit **un dossier existant n’importe où dans le coffre**. Feuillets ne le déplace pas : il devient une source documentaire liée, visible en lecture seule dans Recherche lorsqu’il est extérieur au projet.

---

## 4. Retrouver les propriétés et relations

Les relations peuvent utiliser :

- propriétés YAML ;
- liens Markdown ;
- tags ;
- personnages ;
- lieux ;
- fils narratifs ;
- références Recherche.

Feuillets 2.5 peut **remapper** ses champs logiques vers des propriétés déjà présentes dans le coffre. Ainsi, un projet existant n’a pas besoin d’adopter exactement les noms de propriétés proposés par Feuillets.

Aeon reste plus puissant pour les relations formelles avec rôles et contraintes complexes.

---

## 5. Comparer ordre chronologique et ordre narratif

La **Chronologie** montre l’ordre des dates.

Le **Classeur** montre l’ordre dans lequel le lecteur rencontre les feuillets.

Vous pouvez ainsi repérer retours en arrière, ellipses, anticipations et scènes racontées hors ordre sans maintenir une seconde base de données temporelle.

Le **Plan** complète cette lecture en affichant structure et propriétés dans des colonnes.

---

## 6. Retrouver les Story Arcs

Feuillets utilise des **fils narratifs** projetés dans le **Chemin de fer**.

Cette vue sert à observer où un fil apparaît, disparaît, se résout ou laisse un trou dans la séquence du manuscrit.

Aeon traite les arcs comme des entités temporelles plus générales. Feuillets les garde volontairement proches du texte et de son ordre narratif.

---

## 7. Suivre les personnages dans le temps

Les fiches Personnage peuvent contenir naissance, mort et états datés. Si un feuillet possède une date et mentionne le personnage, **Feuillet → Contexte** peut utiliser ces informations pour signaler :

- âge à cette date ;
- personnage pas encore né ;
- personnage déjà mort ;
- dernier état connu ;
- autre incohérence déductible des données du projet.

Ce contrôle intervient pendant l’écriture, au niveau du passage courant.

---

## 8. Lieux, objets et anachronismes

Recherche peut contenir lieux, objets, techniques ou informations historiques. Contexte peut les faire remonter lorsqu’ils sont pertinents pour le passage et signaler certaines incompatibilités chronologiques.

Feuillets n’est pas un simulateur géographique : il ne calcule pas automatiquement les distances, temps de trajet ou impossibilités de présence entre deux lieux.

---

## 9. Calendriers et durées

Feuillets convient surtout aux dates qui peuvent être représentées de façon lisible dans les propriétés du projet.

Aeon reste nettement plus adapté aux :

- calendriers fictifs complexes ;
- conversions entre calendriers ;
- contraintes temporelles formelles ;
- durées et dépendances propagées automatiquement ;
- modélisations non narratives très détaillées.

Feuillets ne prétend pas à la parité sur ces points.

---

## 10. Retrouver Relationship View

Il n’existe pas une vue unique équivalente. Utilisez le bon outil selon la question :

- liens/backlinks Obsidian pour les relations documentaires ;
- Canvas/Carnet pour la réflexion visuelle ;
- Chemin de fer pour les relations narratives ;
- Chronologie pour les relations temporelles ;
- Feuillet → Contexte pour l’information utile pendant l’écriture.

---

## 11. Retrouver Subway View

Le **Chemin de fer** est l’analogue le plus proche pour un auteur : plusieurs fils peuvent être observés à travers les feuillets du manuscrit.

Ce n’est pas un clone de Subway View. Son axe principal reste la séquence réelle du livre.

---

## 12. Retrouver Spreadsheet et Outline

Utilisez **Plan** pour une lecture tabulaire du manuscrit et de ses métadonnées.

Utilisez le **Classeur** pour la hiérarchie et la navigation.

La double vue du Classeur peut garder l’arborescence des dossiers visible à gauche tout en conservant le Binder normal à droite, ce qui permet de lire la structure d’un coup d’œil.

---

## 13. Retrouver la Mindmap

Le **Carnet** repose sur Canvas : idées libres, groupes, Arbres d’idées, transformation d’une branche en plan puis matérialisation en vrais dossiers et feuillets Markdown.

Le Carnet aide à penser ; le Classeur reste la structure réelle du manuscrit.

---

## 14. Travailler côte à côte

Obsidian permet d’ouvrir le manuscrit avec une Chronologie, une fiche Recherche, un PDF ou un autre document dans une autre leaf.

Les fichiers de dossiers Recherche externes liés peuvent eux aussi être ouverts dans un nouvel onglet ou côte à côte sans être déplacés dans le projet.

La double vue du Classeur fournit en plus un petit accès lecture seule au Coffre pour ouvrir une documentation extérieure sans quitter Feuillets.

---

## 15. Retrouver les contrôles de continuité

**Feuillet → Contexte** transforme certaines données chronologiques en aide active pendant l’écriture.

Selon les données disponibles, il peut afficher ou signaler :

- date de la scène ;
- âge ou état d’un personnage ;
- événement proche ;
- document Recherche pertinent ;
- personnage déjà mort ou pas encore né ;
- objet ou technique anachronique.

Ces résultats dépendent exclusivement des données du projet et restent des aides à la vérification, pas des corrections automatiques.

---

## 16. Réviser sans perdre la chronologie

Feuillets 2.5 améliore aussi la phase de réécriture :

- instantanés et versions ;
- comparateur distinguant ajouts, suppressions, remplacements et déplacements ;
- annotations de travail externes au Markdown ;
- relecture collaborative ;
- Révision DOCX.

La Chronologie reste liée aux mêmes fichiers pendant ces transformations du manuscrit.

---

## 17. Écrire plusieurs scènes en continu

Le mode **Continu** permet d’ouvrir un chapitre, un dossier, une sélection ou le manuscrit comme un seul document éditable. Chaque modification est enregistrée dans le feuillet source correspondant.

Cela permet de corriger un enchaînement temporel sur plusieurs scènes sans perdre la granularité des fichiers ni ouvrir une multitude d’onglets.

---

## 18. Exporter et partager

Feuillets exporte le manuscrit en Markdown compilé, DOCX, EPUB, ODT et PDF desktop. Les informations chronologiques restent dans les fichiers/propriétés du projet.

Il n’existe pas nécessairement d’équivalent à un fichier Aeon interactif autonome. Pour partager la chronologie elle-même, utilisez selon le besoin le coffre, des tableaux, captures, exports ou documents dérivés.

---

# Workflow quotidien équivalent

## Aeon + logiciel d’écriture

```text
Mettre à jour la chronologie
→ contrôler dates, personnages et arcs
→ synchroniser avec le logiciel d’écriture
→ écrire la scène
→ resynchroniser
```

## Feuillets

```text
Choisir ou écrire un feuillet
→ ajouter la date et les propriétés utiles
→ observer Chronologie / Plan / Chemin de fer
→ écrire seul ou en Continu
→ consulter Feuillet → Contexte
→ corriger directement le même fichier Markdown
```

La chronologie n’est plus une base séparée du manuscrit.

---

# Quand Feuillets peut remplacer Aeon

Feuillets peut suffire lorsque votre besoin principal est :

- chronologie d’un roman ou récit ;
- comparaison ordre réel / ordre narratif ;
- suivi simple des personnages ;
- fils narratifs ;
- événements historiques liés au texte ;
- alertes de continuité pendant l’écriture ;
- volonté de tout garder dans le même projet Obsidian.

# Quand garder Aeon

Aeon reste préférable pour :

- calendriers fictifs très complexes ;
- contraintes et dépendances temporelles formelles ;
- modèles relationnels riches ;
- calculs de durées et propagations ;
- projets dont la chronologie est plus importante que le manuscrit lui-même.

---

# Verdict

Feuillets ne remplace pas Aeon Timeline comme moteur général de modélisation temporelle. Il remplace surtout **le besoin de maintenir une chronologie séparée pour vérifier un manuscrit**.

Si la chronologie sert d’abord à écrire un livre cohérent, garder dates, scènes, Recherche, fils narratifs et texte dans le même coffre peut être plus fluide qu’une synchronisation permanente entre deux applications.
