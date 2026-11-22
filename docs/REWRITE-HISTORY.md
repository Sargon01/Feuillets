# Automatic rewrite history / Historique automatique des réécritures

## Utilisation

Activez **Historique automatique** dans Réglages → Interface → Apparence.
L'option est désactivée par défaut. Réglez l'inactivité entre 1 et 1 440 minutes
(10 par défaut). Écrivez dans l'éditeur Markdown ou en Continu : chaque feuillet
possède sa propre intervention, indépendamment des autres et du jour civil.
Une reprise après le délai crée une autre intervention, même le même jour.
La fermeture de l'éditeur, un changement de projet ou le déchargement du plugin
clôture les interventions connues. Désactiver l'option conserve l'historique acquis.

L’onglet **Journal** propose seul une section repliable
**Historique des réécritures**, avec une entrée par feuillet, dans l’ordre du
Binder (dossiers et ordre personnalisé compris). Chaque entrée affiche le titre,
le nombre d’interventions et la date de la dernière. Les groupes sont repliés par
défaut ; un clic les déplie indépendamment et leur état est mémorisé, même après
renommage ou déplacement du feuillet. L’icône de fichier permet de rouvrir le texte.

Dans un groupe ouvert, les interventions vont de la plus récente à la plus
ancienne, avec dates de début et de dernière modification, mots avant/après et
variation signée. L’action discrète « Comparer les états conservés » ouvre les
modes Changements et Versions du comparateur existant, sur deux états en lecture
seule, indépendamment du texte actuel. Chaque groupe affiche 30 interventions à
la fois et permet de remonter plus loin. Les groupes fermés ne construisent pas
leurs lignes détaillées ; aucun état Markdown historique n’est lu pour afficher
la liste. Les historiques de feuillets supprimés restent accessibles après les
feuillets du Binder. Feuillet ne présente aucun historique. Relecture conserve
« Comparer une version » pour comparer un snapshot manuel au texte actuel,
avec le même moteur.

Une reformulation à nombre de mots constant est conservée. Une simple ouverture,
une modification limitée au frontmatter, ou une intervention annulée jusqu'au
corps initial ne produit pas d'entrée. Le compte réutilise le compteur Feuillets.
L'origine indiquée dans l’infobulle de la date désigne une surface technique (Markdown, Continu, origine
externe ou indéterminée), jamais une attribution humaine ou une détection d'IA.

Les snapshots manuels restent disponibles pour comparer/restaurer un état avec
le texte actuel. Dupliquer comme nouvelle version reste une décision éditoriale.
Les ZIP restent les sauvegardes contre les pertes. L'export `.feuil` transporte un
projet et exclut ce nouvel historique personnel par défaut ; les anciens
snapshots ne changent pas de traitement. Les échanges `.feuillets`, le calendrier,
les statistiques quotidiennes et leur progression non négative, le Carnet,
Recherche et les Notes de travail conservent leurs rôles. Aucun texte de Notes de
travail n'est écrit automatiquement.

## Storage and integration

The canonical folder helper resolves both structured and adopted projects:

```text
_Feuillets/RewriteHistory/
  index.json                # version 1, project UUID and sheet UUID/path/ctime/tombstone
  events/<UUID>.json         # version 1, one intervention, observed times and word counts
  states/<SHA-256>.md        # exact immutable source states, including original frontmatter
```

The namespace is fixed across interface languages. It is reserved for this
feature. Manual snapshot paths, names and discovery are unchanged; old snapshots
are never renamed, deleted or reassigned. The separate namespace cannot collide with a manual snapshot folder named after a sheet. The automatic identity index solves
homonymous sheet and timestamp collisions without modifying manuscript content.
Observed file/folder renames update identity paths; deletion tombstones the identity,
so a new file at the same path cannot inherit an observed deleted sheet's history.
Project identity stays in the project's own storage, outside plugin `data.json`.
States with identical full source content share a SHA-256 reference. There is no
automatic purge. Research, Versions, auxiliary material and folder notes are
excluded through project membership and existing folder resolvers.

`cm-rewrite-history.ts` reads `ViewUpdate.startState` and `state` for actual native
editor document changes, including undo/redo. It does not depend on a later
`vault.modify` to invent a baseline. `ScriveningsSession.handleChanges` passes the
old and new bodies of only accepted touched segments, before replacing its
in-memory document or scheduling source writes. It uses existing segment mapping,
boundary guards and saving/conflict handling.

The first pre-edit string is held synchronously and queued for immediate
persistence. Intermediate edits replace one in-memory end state. A throttled
checkpoint (approximately two seconds while writing) stores the latest text in
the pending event JSON; it does not create a Markdown snapshot per keystroke.
Closure stores the final immutable Markdown and marks the event complete. The
recorded end time is the last observed edit, not the time the inactivity timer
ran. A coarse 15-second timer detects inactivity, and every edit checks the
configured threshold itself. Concurrent divergent editor baselines close separate
chains instead of claiming an unobserved continuous transformation.

Startup recovers a pending event from its actually persisted checkpoint, marks it
as recovered, and closes it before a new intervention. It does not claim that
uncheckpointed changes survived. Merely loading or reading a manuscript primes
in-memory baselines and creates no history state. Known project files are primed
for external change detection; changes without a previously read baseline raise
a notice and create no fabricated before-state. Observed times for external
changes are detection times. Changes made while Obsidian/the plugin is not running
are not tracked, and offline renames cannot be inferred reliably without a stored
identity in the file; they may start a separate identity. Creation time helps
separate replaced paths after restart but is not a filesystem identity proof.

## Failure boundaries and privacy

All project writes are queued. `Vault.process` compares JSON against the last
observed contents and refuses a concurrent overwrite. State contents are verified
before reuse and comparison. Unsupported/corrupt JSON, missing states and conflicts
produce visible warnings rather than substituting the current manuscript for a
missing historical state. Failed jobs remain queued in memory and retry on later
checkpoints. A transient full disk does not mark an event complete until its
states and metadata are persisted. Closing views and unloading request a flush;
Obsidian does not guarantee awaiting asynchronous plugin unload on process exit.

There is necessarily a crash window before the first asynchronous disk write,
and up to the last checkpoint for subsequent edits. A forced process termination
or disk failure can leave incomplete history. The persisted pending checkpoint
is the recovery boundary, not a backup guarantee. A partial/corrupt JSON write is
reported and left untouched: keep the manuscript and history folder, resolve the
storage issue/conflict before restarting, and preserve any damaged file for
manual recovery. No automatic destructive repair or purge runs. Manuscript saves
never wait for successful history writes; a history error cannot discard or block
a Continu edit. Keep Obsidian open after a persistence warning if pending states
must be retained for retry.

History stays inside the local vault; there is no account, network request, AI,
telemetry, keystroke log or elapsed-time tracking. As with other vault data, vault
synchronisation or a ZIP backup may copy it. `.feuil` collection explicitly skips
only this reserved subtree, including when encountered through linked Research;
manual snapshots, versions and unrelated project files keep their prior behavior.
