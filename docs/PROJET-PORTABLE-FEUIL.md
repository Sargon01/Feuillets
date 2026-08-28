# Projet portable `.feuil` — exporter et réimporter un projet Feuillets

> **Français** · [English](PORTABLE-FEUIL-PROJECT.md) · [Index](README.md)

Un fichier **`.feuil`** est une archive portable d’un projet Feuillets. Il sert à déplacer, transmettre ou conserver un état transportable du projet sans transformer le manuscrit en format propriétaire.

Après import, le projet redevient un dossier Obsidian ordinaire : les textes restent des fichiers Markdown, les dossiers restent de vrais dossiers du coffre et Feuillets restaure les réglages de projet pris en charge.

## Quand utiliser un `.feuil`

Utilisez un `.feuil` lorsque vous voulez :

- transférer un projet vers un autre coffre Obsidian ou un autre ordinateur ;
- conserver une copie transportable du projet à un instant donné ;
- transmettre un projet Feuillets complet à une autre installation de Feuillets ;
- déplacer un projet sans perdre l’ordre du manuscrit, certains réglages de dossier ou les associations Recherche prises en charge.

Un `.feuil` n’est ni un format d’écriture quotidien, ni un service de synchronisation, ni un remplacement des sauvegardes régulières.

## Exporter un projet

1. Ouvrez **Gérer les projets**.
2. Repérez le projet à exporter.
3. Utilisez l’action **Exporter en `.feuil`** associée au projet.
4. Feuillets prépare l’archive puis déclenche son téléchargement avec un nom dérivé du nom du projet.

Avant de créer l’archive, Feuillets tente d’enregistrer les modifications encore en attente dans **Continu**. Si ces écritures ne peuvent pas être sécurisées, l’export est interrompu au lieu de produire une archive potentiellement incohérente.

## Ce que contient l’archive

Le `.feuil` contient l’arborescence située dans la racine réelle du projet, à l’exception des **Backups** reconnus par Feuillets. Cela comprend donc les fichiers du projet et peut inclure les données auxiliaires Feuillets qui vivent dans cette racine.

Le manifeste de l’archive conserve également les informations nécessaires pour reconstruire le projet, notamment :

- le nom du projet et son type de racine ;
- le chemin du manuscrit dans le projet ;
- le rôle structurel du premier niveau ;
- les métadonnées propres au projet prises en charge ;
- l’ordre enregistré des dossiers et feuillets ;
- les positions et objectifs de dossiers enregistrés ;
- l’état narratif lié aux fils utilisé par le projet ;
- les associations entre nœuds du Classeur et dossiers Recherche.

### Dossiers Recherche liés hors du projet

Si un dossier du Classeur est explicitement associé à un dossier Recherche situé **hors de la racine du projet**, Feuillets copie également ce dossier Recherche dans l’archive.

Le `.feuil` reste ainsi transportable : il ne dépend pas du chemin absolu qu’occupait ce dossier dans le coffre d’origine.

## Ce qui n’est pas inclus

Le `.feuil` n’a pas vocation à capturer l’ensemble du coffre Obsidian.

Ne sont notamment pas inclus :

- les **Backups** Feuillets du projet ;
- les fichiers du coffre situés hors du projet, sauf les dossiers Recherche externes explicitement associés ;
- les réglages globaux de Feuillets qui ne sont pas des données propres au projet exporté ;
- les réglages d’Obsidian, thèmes et plugins tiers installés sur la machine ;
- les fichiers d’autres projets du même coffre.

Pour la récupération après incident et l’historique local, voir [Réécriture, sauvegardes et versions](VERSIONNAGE-ET-SECURITE.md).

## Importer un `.feuil`

1. Ouvrez **Gérer les projets**.
2. Choisissez **Importer un `.feuil`**.
3. Sélectionnez l’archive `.feuil`.
4. Feuillets affiche le nom du projet détecté.
5. Choisissez le **dossier parent** dans lequel créer le projet.
6. Choisissez le **nom du nouveau dossier**.
7. Lancez l’import.

L’import crée toujours un **nouveau dossier de projet**. Le chemin de destination ne doit pas déjà exister : Feuillets ne fusionne pas un `.feuil` avec un projet existant et n’écrase pas silencieusement un dossier présent dans le coffre.

À la fin de l’import, Feuillets restaure les réglages de projet pris en charge, ajoute le projet à la liste des projets et l’ouvre comme projet actif.

## Que deviennent les dossiers Recherche externes ?

Les dossiers Recherche qui étaient liés depuis l’extérieur du projet d’origine sont recréés **dans le nouveau projet**, sous un espace du type :

`_Feuillets/Recherche liée importée…`

Feuillets remappe ensuite les associations du Classeur vers ces nouvelles copies.

L’import ne tente donc pas de recréer l’ancien chemin absolu du coffre source et ne modifie pas un éventuel dossier portant le même nom ailleurs dans le coffre de destination.

## Conflits et import interrompu

Le principe est volontairement conservateur :

- aucune fusion avec un dossier de destination existant ;
- aucune substitution silencieuse d’un fichier ou dossier déjà présent à la destination ;
- validation de l’archive avant matérialisation du projet ;
- si une erreur survient après la création du dossier de destination, Feuillets tente de supprimer le projet partiellement créé afin de ne pas laisser un import incomplet.

Si le nettoyage automatique échoue lui-même, Feuillets signale explicitement que le dossier importé doit être vérifié.

## `.feuil`, `.feuillets`, Backup ou export ?

| Outil | Usage principal | Contient le projet complet ? | Modifie le format du manuscrit ? |
| --- | --- | ---: | ---: |
| **`.feuil`** | transporter/réimporter un projet Feuillets | Oui, dans la portée décrite ci-dessus | Non |
| **`.feuillets`** | échange de relecture collaborative | Non | Non |
| **Backup Feuillets** | récupération locale après incident | copie de sécurité locale | Non |
| **Instantané** | point de comparaison avant réécriture | état d’un texte/version | Non |
| **DOCX / PDF / EPUB / ODT / Markdown compilé** | publier, transmettre ou imprimer un document | Non | produit une sortie séparée |

La distinction importante est la suivante :

- **`.feuil` transporte un projet** ;
- **`.feuillets` transporte un tour de relecture** ;
- **Backup et instantané protègent le travail** ;
- **les exports produisent un document final ou intermédiaire**.

Voir aussi [Relecture collaborative](RELECTURE-COLLABORATIVE.md) et [Composition et export](COMPOSITION-ET-EXPORT.md).

## Portabilité et sécurité

Le format `.feuil` actuel utilise un manifeste versionné et des chemins relatifs. Feuillets refuse les chemins absolus, les traversées de répertoires et plusieurs formes de noms non portables afin d’éviter qu’une archive écrive hors de sa destination.

Les limites techniques actuelles du format sont :

- au maximum **20 000 entrées** ;
- au maximum **1 Gio** de données décompressées ;
- un manifeste de **1 Mio** au maximum.

Une archive dont le format ou la version n’est pas pris en charge est refusée plutôt qu’importée partiellement.

## Le `.feuil` crée-t-il une dépendance à Feuillets ?

Non pour les textes du projet.

Le `.feuil` est un **conteneur de transport**. Une fois importé, le projet est à nouveau constitué de fichiers et dossiers ordinaires dans le coffre Obsidian. Les textes restent du Markdown lisible et éditable sans `.feuil`.

En revanche, certaines informations propres au fonctionnement de Feuillets — ordre enregistré, objectifs de dossiers, associations Recherche ou autres métadonnées de projet — ont besoin de Feuillets pour être interprétées et restaurées.

## Bonnes pratiques

- Utilisez un `.feuil` pour transporter un projet, pas comme unique stratégie de sauvegarde.
- Conservez vos Backups et instantanés selon vos besoins de réécriture et de récupération.
- Après un transfert vers une autre machine, contrôlez les éventuels plugins ou thèmes Obsidian dont votre coffre dépend : ils ne font pas partie de l’archive `.feuil`.
- Pour transmettre seulement un texte destiné à la lecture ou à l’édition, utilisez plutôt les exports de **Composition**.
- Pour un échange auteur/relecteur Feuillets, utilisez la **Relecture collaborative `.feuillets`**.

Pour comprendre les réglages propres au projet, voir [Projet et propriétés YAML](PROJET-ET-PROPRIETES-YAML.md).
