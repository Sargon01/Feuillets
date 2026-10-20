# Le Carnet — des idées au manuscrit

> **Français** · [English](HOW-TO-NOTEBOOK.md) · [Index](README.md)

Le **Carnet** est l’atelier visuel de Feuillets dans le Canvas natif d’Obsidian : notes libres, cartes de fichiers, relations, mise en forme, agencement, mindmaps et préparation du manuscrit. Le texte du livre reste dans ses fichiers Markdown ; les idées non converties restent dans le fichier `.canvas`.

Un parcours possible : **capturer des idées → organiser les notes → établir des relations → structurer un plan → transformer les idées en manuscrit**. Vous pouvez vous arrêter à n’importe quelle étape.

## Choisir le bon Carnet

- Le bouton **Carnet** du Classeur ouvre le Carnet global du projet.
- Dans le menu contextuel d’un dossier, **Créer le Carnet** puis **Ouvrir le Carnet** donnent un espace propre à ce dossier.
- L’onglet latéral **Carnets**, section **Carnets disponibles**, permet de retrouver les Carnets enregistrés, de les ouvrir ou de créer celui du contexte proposé. Le chemin affiché aide à distinguer les dossiers homonymes.

Le titre d’un Carnet de dossier est **Carnet · Nom du dossier**. Son identité est indépendante du nom du dossier : un renommage ou un déplacement suivi par Feuillets dans le projet conserve l’association. Supprimer le dossier et recréer ailleurs un dossier homonyme n’équivaut pas à déplacer le dossier initial.

Un dossier Recherche explicitement associé à un dossier du Classeur peut partager le **même Carnet logique**, lorsque son propriétaire est déterminé sans ambiguïté. Les documents Recherche ne sont pas déplacés. Un ancien Carnet distinct peut être conservé plutôt que fusionné automatiquement.

Voir [Classeur et navigation](CLASSEUR-ET-NAVIGATION.md), [Espaces de travail](ESPACES-DE-TRAVAIL.md) et [Recherche et dossiers associés](RECHERCHE-ET-DOSSIERS-ASSOCIES.md).

## 1. Capturer sans interrompre l’écriture

La commande **Carnet : noter une idée** ouvre une saisie rapide et ajoute une note texte. Depuis la palette, elle vise le Carnet global ; depuis **Carnets → Outils du Carnet**, elle utilise le Carnet choisi. Elle ne transforme pas l’idée en feuillet et n’impose pas de quitter le texte courant.

Pour travailler avec le manuscrit déjà écrit :

- **Carnet : ajouter le feuillet courant** ajoute une carte de fichier ;
- glissez un ou plusieurs feuillets depuis le Classeur, ou des documents depuis Recherche, vers le Carnet ;
- créez des cartes texte, des groupes et des cartes de fichiers avec les outils natifs Canvas.

Une carte de fichier montre le fichier existant : son ajout ne déplace ni ne renomme le Markdown. Modifier le contenu du fichier depuis sa carte reste une modification du vrai document. Une note texte libre, au contraire, n’est pas encore un fichier du manuscrit.

**Exemple :** notez trois scènes possibles, ajoutez le feuillet du chapitre en cours et une fiche documentaire. Déplacez ces éléments pour comparer leurs rapports avant de décider de l’ordre du livre.

## 2. Organiser les notes libres

Les notes texte libres reçoivent par défaut une présentation sans cadre. L’**Inspecteur de sélection** et la barre flottante adaptent leurs contrôles à la carte, à la connexion ou à la sélection courante. Les blocs structurés, comme une mindmap ou un Plan Binder, gardent leurs propres règles.

### Habillage et dimensions

Pour une note ou une carte de fichier ordinaire compatible, choisissez :

| Habillage | Utilisation |
|---|---|
| **Sans cadre** | Texte libre sur la surface du Carnet |
| **Contour simple** | Délimiter une idée |
| **Coins arrondis** | Distinguer une famille de notes |
| **Fond coloré** | Mettre une note en évidence |
| **Carte Canvas classique** | Retrouver la présentation native de la carte |

La couleur de carte est distincte de la couleur du texte. Les couleurs suivent la palette Canvas et le thème Obsidian. Les cartes de fichiers conservent leur aperçu Markdown, leur défilement, leurs liens et leurs outils natifs. Les réglages typographiques compatibles modifient la présentation de l’aperçu, sans modifier le Markdown ni les contrôles natifs. Les titres, blocs de code et autres éléments ayant leur propre style conservent les règles du rendu Markdown ; les commandes de formatage d’un passage restent réservées aux notes texte.

Le contenu et la typographie font adapter la taille des notes texte compatibles. Les cartes de fichiers conservent leurs dimensions et leur défilement natifs. Après un redimensionnement manuel en largeur, le texte revient à la ligne dans la largeur choisie et la hauteur s’adapte au contenu. Une modification de taille de police ne doit pas être interprétée comme une mise à l’échelle globale du Canvas. La carte classique conserve le comportement de présentation natif.

### Typographie de la note et formatage d’un passage

L’inspecteur propose une taille de **12 à 40 px**, le retour à la taille du thème, les alignements gauche/centré/droite/justifié et les couleurs de texte rouge, orange, vert, cyan ou violet, ainsi que la couleur du thème. Ces réglages portent sur la note, pas seulement sur un mot.

Pour **Gras**, **Italique**, **Barré** ou **Souligner (un seul paragraphe)**, entrez dans l’édition d’une note et sélectionnez le passage. Sans sélection textuelle ni éditeur compatible, l’action n’est pas disponible. Le soulignement insère du HTML inline `<u>…</u>` et refuse les sélections contenant un retour à la ligne ; les autres formats utilisent les commandes Markdown natives.

### Aligner, répartir et empiler

Sélectionnez plusieurs cartes pour afficher les actions d’agencement disponibles : **Aligner**, **Disposer**, **Répartir**, **Justifier verticalement** et **Empiler**. Les actions d’alignement et de distribution réutilisent les opérations natives Canvas ; la distribution demande au moins trois éléments. Une sélection mêlant des éléments structurels protégés peut rendre les outils indisponibles.

Deux opérations différentes concernent les notes texte libres :

| Action | Effet immédiat | Relation conservée |
|---|---|---|
| **Empiler les notes** | Range au moins deux notes verticalement, bord à bord, selon leur ordre spatial | Aucune : chaque note reste indépendante |
| **Empiler dynamiquement** | Crée une pile verticale de notes indépendantes admissibles | Oui : l’ordre et l’appartenance sont enregistrés dans le Canvas |

Une pile dynamique conserve les largeurs de ses notes et se réajuste lorsque leur hauteur change, notamment après édition ou changement typographique. Elle n’est pas un groupe Canvas qui déplacerait automatiquement tous ses membres comme un objet unique. Déplacer manuellement un membre peut le sortir de la pile. **Dissocier l’empilement**, disponible en sélectionnant un membre, dissout la relation de la pile concernée sans déplacer les rectangles. Une pile qui ne comporte plus assez de membres valides est nettoyée.

Ces opérations concernent les notes libres compatibles ; elles ne réorganisent pas un Plan Binder ou une mindmap à leur place. L’empilement dynamique exige des notes qui n’appartiennent pas déjà à une pile.

## 3. Relier les idées

Les poignées et connexions natives Canvas restent disponibles. Feuillets ajoute un geste façon Scapple sur les **cartes ordinaires**, notes texte et cartes de fichiers :

1. Sortez de l’édition ou de la lecture interactive de la carte.
2. Avec la souris, faites glisser la carte depuis sa surface native de déplacement sur une autre carte ordinaire, sans touche modificatrice.
3. Relâchez : la relation est créée et la carte déplacée retrouve sa position de départ.

Pour une seule carte, répéter ce geste peut retirer une relation simple existante : elle doit être unique, sans libellé, couleur, habillage personnalisé ni flèche. Une relation enrichie est conservée ; utilisez alors ses outils Canvas pour la modifier ou la supprimer.

Pour relier plusieurs idées à une même destination, sélectionnez-les puis faites glisser l’une des cartes sélectionnées sur une carte extérieure à la sélection. Feuillets ajoute les connexions manquantes et **conserve les relations existantes** : le geste multiple ne les bascule pas vers la suppression.

Ce raccourci est limité au Carnet actif, modifiable et à une sélection de cartes ordinaires compatibles, y compris les feuillets et fiches Recherche déposés ou convertis. Il ne s’applique pas aux groupes, éléments de mindmap, Plan Binder ou cartes structurelles. Une édition en cours, une sélection contenant un élément structurel, le déplacement du fond avec Espace ou un contexte devenu périmé empêchent la conversion du geste. Un Canvas ordinaire du coffre n’est pas transformé en Carnet par ce mécanisme.

Une note appartenant à une pile dynamique n’est pas admissible à ce geste de connexion libre tant que sa relation de pile est conservée. Dissociez la pile avant de l’utiliser comme note indépendante.

### Apparence des connexions

Sélectionnez une connexion compatible dans l’inspecteur ou ouvrez son menu **Apparence** :

- **Tracé** : **Droite**, **Courbe** ou **Map** ;
- **Trait** : **Continu**, **Tirets** ou **Pointillés** ;
- **Épaisseur** : **Fin**, **Normal** ou **Épais** ;
- **Flèches** : aucune, début, fin ou les deux ;
- couleur par défaut ou l’une des six couleurs Canvas.

Le tracé **Map** utilise des segments orthogonaux et cherche un passage autour des cartes ; il ne déplace pas les cartes et ne garantit pas un routage parfait dans toute disposition encombrée. Les connexions autour des notes libres suivent leurs limites et leur contenu lorsque les dimensions changent. Les courbes natives gardent leur géométrie native ; les connexions structurelles gérées par un bloc restent protégées.

Les relations ordinaires entre notes et cartes de fichiers sont initialement droites, fines et pointillées, sauf réglage explicite. Le geste de connexion libre crée des liens sans flèches, sauf préférence de création explicite. Les marqueurs natifs déjà enregistrés, y compris les flèches, restent respectés. **Rétablir l’apparence par défaut de la connexion** retire couleur, flèches et surcharges de trait/épaisseur, mais **conserve le tracé explicitement choisi**.

## Inspecteur, barre flottante et styles futurs

L’onglet **Carnets** réunit **Carnets disponibles**, **Inspecteur de sélection**, **Outils du Carnet**, **Styles par défaut** et **Affichage**. Le contexte du Canvas sélectionné reste retenu lorsque vous donnez le focus à son inspecteur ; changer réellement de document peut le rendre indisponible. Les commandes sont réévaluées selon les objets encore sélectionnés.

Dans **Affichage**, **Afficher la barre flottante** permet de choisir si ces outils accompagnent aussi la sélection sur le Canvas. Les menus natifs restent distincts des commandes ajoutées par Feuillets.

**Styles par défaut** règle les **nouvelles cartes ordinaires**, y compris les fichiers déposés depuis le Classeur ou Recherche, et les **nouvelles connexions libres** : habillage, couleurs, typographie et propriétés de connexion proposées. Ces préférences ne modifient pas rétroactivement les éléments existants et ne transforment pas les éléments structurels d’une mindmap ou du Plan. Le choix Carte Canvas classique est une apparence de carte existante ; il ne fait pas partie des quatre habillages proposés pour les futures notes libres.

Pour changer une carte déjà présente, utilisez l’inspecteur ; pour préparer les suivantes, utilisez les styles par défaut. **Rétablir les valeurs par défaut** réinitialise les préférences de création, pas l’ensemble du Carnet.

## Le Plan du Binder dans le Carnet

Le **Plan du Binder** est une carte interactive qui projette la structure réelle du Classeur dans le Carnet. Le point d’entrée actuel **Créer ou actualiser le Plan Binder du projet** cible toujours le **Carnet global et le manuscrit complet**, même si vous étiez en train de travailler dans un dossier. Le panneau Carnets ne propose cette action que pour le Carnet global. Un ancien Plan de dossier peut encore être reconnu par le modèle ; cela ne change pas la portée de cette commande.

Choisissez **Créer ou actualiser le Plan Binder du projet** pour le créer ou le remettre à jour depuis le Binder. Cette actualisation remplace son état de travail : appliquez d’abord les modifications que vous souhaitez conserver. Un Carnet ne doit contenir qu’un seul Plan du Binder.

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

Si une erreur survient pendant les écritures, l’interface peut signaler un retour arrière incomplet : vérifiez alors le Binder et la notification. La validation préalable ne garantit pas qu’aucune panne d’écriture ne puisse survenir.

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

## 4. Passer des idées au texte

Dans **Outils du Carnet → Convertir / Envoyer**, utilisez :

- **Carnet : passer des idées au manuscrit…** pour choisir les notes à convertir et leur destination ;
- **Carnet : transformer des idées en fiches de recherche…** pour conserver les idées comme documentation ;
- **Carnet : créer un chapitre…** pour préparer un dossier et les feuillets admissibles à partir d’un groupe ou des éléments choisis.

Les dialogues permettent de vérifier les titres, le choix et l’ordre avant création. Une conversion crée un vrai fichier Markdown et remplace la note convertie par une carte de fichier en conservant sa position, ses dimensions, son habillage, sa typographie compatible et les propriétés de ses connexions. Les cartes de fichiers existantes ne doivent pas être confondues avec des notes texte à convertir. Vérifiez les destinations proposées : la position spatiale d’une carte ne définit pas à elle seule son futur dossier.

**Exemple :** empilez ponctuellement cinq idées pour les lire dans un ordre provisoire ; reliez les pistes qui dépendent les unes des autres ; créez une mindmap pour une branche ; convertissez les idées retenues en feuillets ; ouvrez enfin le Plan Binder global pour préparer la structure réelle. Déplacer librement les autres cartes reste sans effet sur l’ordre du manuscrit.

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

Si Advanced Canvas est installé, il peut apporter des accès contextuels supplémentaires, notamment aux conversions, à la scission et à la fusion de cartes. Les notes libres, le glisser pour connecter, l’inspecteur, les styles, les empilements, le Plan et les mindmaps décrits ici ne le nécessitent pas. Un Carnet doit rester ouvrable et utilisable comme Canvas même sans Advanced Canvas.
