# Le Carnet — des idées au manuscrit

> **Français** · [English](HOW-TO-NOTEBOOK.md) · [Index](README.md)

Le **Carnet** est l’espace visuel de Feuillets fondé sur le Canvas natif d’Obsidian. Il sert à réfléchir autour du manuscrit sans transformer le Canvas en base de données parallèle : les feuillets restent des fichiers Markdown ordinaires et le Carnet reste un vrai fichier Canvas.

Feuillets propose un **Carnet global** pour le projet et des **Carnets attachés aux dossiers**. Un Carnet de dossier conserve son identité même si le dossier est renommé ou déplacé dans le projet.

## Ouvrir un Carnet

Le bouton **Carnet** du Classeur ouvre le Carnet global du projet.

Pour travailler autour d’un dossier précis du manuscrit, ouvrez son menu contextuel :

- **Créer le Carnet** crée son Carnet s’il n’en possède pas encore ;
- **Ouvrir le Carnet** rouvre le Carnet déjà associé.

Le titre d’un Carnet de dossier prend la forme **Carnet · Nom du dossier**.

Un dossier Recherche explicitement associé à un dossier du Classeur peut partager le **même Carnet logique** que ce dossier. L’objectif est de garder au même endroit le manuscrit et la documentation qui appartiennent au même contexte, sans déplacer les fichiers de Recherche.

Voir aussi [Classeur et navigation](CLASSEUR-ET-NAVIGATION.md) et [Recherche et dossiers associés](RECHERCHE-ET-DOSSIERS-ASSOCIES.md).

## Utiliser le Canvas librement

Un Carnet reste un Canvas Obsidian : vous pouvez y créer des cartes de texte, des cartes de fichier, des groupes et des liens, puis les déplacer librement.

Feuillets ajoute seulement les ponts utiles à l’écriture :

- un fichier glissé depuis le Classeur ou la Recherche devient une **vraie carte de fichier** dans le Carnet ;
- le fichier Markdown source n’est ni déplacé, ni renommé, ni modifié par ce glisser-déposer ;
- une idée textuelle peut être capturée puis transformée en feuillet ou en document de Recherche ;
- les cartes et liens Canvas ordinaires restent indépendants des structures gérées par Feuillets.

Vous pouvez donc utiliser le Carnet comme un espace de réflexion libre, une table de travail visuelle ou simplement une feuille blanche autour d’un dossier.

## Le Plan du Binder dans le Carnet

Le **Plan du Binder** est une carte interactive qui projette la structure réelle du Classeur dans le Carnet. Il est disponible dans le Carnet global et dans les Carnets de dossier du manuscrit.

Choisissez **Créer le Plan du Binder** pour l’ajouter. Un Carnet ne doit contenir qu’un seul Plan du Binder.

Le Plan affiche la hiérarchie du périmètre concerné et permet de préparer des modifications sans écrire immédiatement dans le coffre.

### Modifier le Plan

Dans le Plan, vous pouvez notamment :

- modifier le titre affiché d’un feuillet ;
- renommer un dossier ;
- ajouter un nouveau feuillet ou un nouveau dossier ;
- déplacer et réordonner les lignes ;
- indenter ou désindenter une ligne ;
- replier ou déplier une branche.

Le clavier permet de travailler comme dans un outliner :

- **Entrée** crée un nouveau feuillet ;
- **Cmd/Ctrl+Entrée** crée un nouveau dossier ;
- sur un dossier actif, le nouvel élément est créé à l’intérieur ; sur un feuillet, il est créé comme frère ;
- **Tab / Shift+Tab** indentent ou désindentent lorsque la structure le permet ;
- **Alt+↑ / Alt+↓** déplacent la ligne ;
- **Échap** annule l’édition du titre en cours.

Pour un feuillet existant, le Plan modifie son **titre court** sans renommer son fichier Markdown sur disque. Pour un dossier, le titre correspond au nom réel du dossier.

### Actualiser puis appliquer

Le Plan sépare volontairement la réflexion de l’écriture réelle dans le Binder :

1. **Actualiser depuis le Binder** relit la structure réelle ;
2. modifiez le Plan ;
3. l’indicateur **Modifications non appliquées** signale que le Plan diffère du Binder ;
4. **Appliquer au Binder** exécute les changements après validation.

Feuillets vérifie l’ensemble des opérations avant la première écriture. Si le Binder a changé entre-temps, si un nom entre en collision ou si une opération sortirait du périmètre du Plan, l’application est refusée plutôt que de modifier partiellement le projet.

Le Plan ne sert pas à supprimer silencieusement des éléments existants du Binder. Les brouillons créés dans le Plan peuvent être retirés avant application, mais un élément réel disparu du Plan doit être rétabli avant de pouvoir appliquer.

## Mindmaps

Un même Carnet peut contenir une ou plusieurs **mindmaps** sans empêcher l’utilisation libre du reste du Canvas.

Choisissez **Créer une mindmap**. Feuillets crée une racine **Idée centrale** et un groupe Canvas qui contient la structure.

Sur une carte de mindmap :

- **Tab** crée un enfant ;
- **Entrée** crée un frère lorsque la carte possède un parent ;
- **Shift+Tab** remonte la branche d’un niveau lorsque c’est possible ;
- une branche peut être déposée sur une autre carte pour changer de parent ;
- **Replier/déplier cette branche** masque ou réaffiche ses descendants sans supprimer les données ;
- **Mindmap : changer l’orientation** bascule entre disposition horizontale et verticale ;
- **Réorganiser la mindmap** recalcule proprement la disposition.

Feuillets refuse les reparentages qui créeraient un cycle ou mélangeraient deux mindmaps distinctes. Les cartes et liens libres placés à côté restent intacts.

Une ancienne branche d’**Arbre d’idées** peut être convertie explicitement avec **Convertir en mindmap**. La conversion porte seulement sur la branche choisie ; les autres éléments du Canvas ne sont pas réorganisés.

## Carnet et manuscrit restent distincts

Le Carnet sert à réfléchir, organiser et visualiser. Le Markdown reste la source du texte.

Cette séparation permet de travailler librement sans enfermer le projet :

- déplacer une carte ne déplace pas un fichier dans le Binder ;
- relier deux cartes ne crée pas une propriété cachée dans le manuscrit ;
- le **Plan du Binder** ne modifie le Binder qu’au moment explicite **Appliquer au Binder** ;
- les mindmaps n’imposent aucune structure au reste du projet.

Pour replacer le Carnet dans l’ensemble du travail, voir [Le parcours d’un auteur](PARCOURS-AUTEUR.md).

## Advanced Canvas

**Advanced Canvas n’est pas requis pour le Plan ni pour les raccourcis de la mindmap.** Le Carnet s’appuie d’abord sur le Canvas natif d’Obsidian.

Si Advanced Canvas est installé, Feuillets peut profiter de ses améliorations visuelles et ergonomiques sans faire de ce plugin une dépendance obligatoire. Un Carnet doit rester ouvrable et utilisable comme Canvas même sans Advanced Canvas.
