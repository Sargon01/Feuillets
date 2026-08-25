# Présentation

> **Français** · [English](PRESENTATION-EN.md) · [Index](README.md)

## Même Markdown, autre rendu

La Présentation n’est pas un second document à maintenir.

Le même Markdown peut être rendu :

- comme **Document** continu ;
- comme **Présentation** 16:9.

Vous n’avez donc pas à dupliquer votre cours, votre rapport ou votre intervention pour fabriquer des diapositives.

## Créer les diapositives

Séparez les diapositives avec :

```markdown
---
```

Exemple :

```markdown
# L’eau, une ressource sous tension

Une ressource indispensable mais inégalement disponible.

---

## Pourquoi les usages entrent-ils en conflit ?

> [!question-directrice]
> Comment arbitrer entre besoins domestiques, agriculture et tourisme ?
```

`---` appartient au Markdown de présentation. Les réglages fins de disposition restent, eux, hors du Markdown.

## Mise en page automatique

Feuillets analyse le contenu de chaque diapositive et choisit automatiquement une composition adaptée.

Les grandes familles de rendu sont :

- **FLOW** — flux principal ;
- **SPLIT** — deux zones lorsque le contenu s’y prête ;
- **STACK** — empilement adapté à certaines compositions.

L’objectif est de laisser l’auteur écrire le contenu plutôt que positionner manuellement chaque bloc.

## Titres, texte et médias

Les titres initiaux restent au-dessus du contenu de la diapositive.

Lorsqu’un média et du texte peuvent être associés, Feuillets peut répartir automatiquement l’espace en tenant compte notamment :

- de l’orientation du média ;
- de la quantité de texte ;
- de l’espace réellement disponible.

Les images utilisent les liens et largeurs Obsidian habituels.

```markdown
![[illustration.png|690]]
```

## Deux blocs textuels

Lorsque deux blocs directs se prêtent à une répartition, Feuillets peut choisir une composition en deux colonnes et mesurer plusieurs proportions avant de retenir celle qui convient le mieux.

## Groupes de callouts et rôles

Les rôles sémantiques peuvent également aider la composition.

Par exemple, plusieurs callouts peuvent être regroupés de manière lisible sans que l’auteur ait à définir des coordonnées ou des colonnes dans le Markdown.

Les rôles restent cependant facultatifs : une diapositive peut être composée de texte Markdown ordinaire.

Voir [Rôles sémantiques](ROLES-SEMANTIQUES.md).

## Citations longues

Les citations longues utilisent un profil plus compact lorsque cela permet de limiter le débordement sans transformer le contenu.

## Notes du présentateur

Utilisez :

```markdown
> [!speaker-notes]
> Rappeler ici l’exemple de la sécheresse de 2022.
```

Les `speaker-notes` :

- appartiennent à la diapositive ;
- ne sont pas projetées ;
- ne sont pas un rôle sémantique Feuillets.

Elles servent à préparer ce qui doit être dit sans l’afficher au public.

## Vidéo

La Présentation prend en charge les médias vidéo compatibles, notamment MP4.

Feuillets tient compte des dimensions réelles du média avant de finaliser la disposition.

## Thèmes

Les thèmes de présentation disponibles comprennent :

- `classic`
- `course`
- `ivory`
- `slate`
- `dark`

Le thème modifie l’apparence, pas le contenu.

## Débordement

Feuillets mesure le contenu réellement rendu et cherche une composition qui tient dans la diapositive.

La mise en page automatique reste prioritaire.

## Forcer exceptionnellement une disposition

Lorsque l’automatisme ne correspond pas au besoin, la disposition de diapositive peut être réglée dans Feuillets.

Choix :

- **Auto** — aucun override ;
- `flow`
- `columns`
- `image-left`
- `image-right`

Ces réglages sont stockés hors du Markdown source.

### `flow`

Force le flux principal.

### `columns`

Demande une composition en colonnes lorsque le contenu est compatible.

### `image-left`

Place le média visuel admissible à gauche.

### `image-right`

Place le média visuel admissible à droite.

Si une disposition forcée n’est pas applicable au contenu, Feuillets revient à l’automatisme plutôt que de produire une mise en page incohérente.

## Exemple complet

```markdown
# Les conflits d’usage

> [!introduction]
> Une même ressource peut répondre à plusieurs besoins concurrents.

---

## Trois acteurs, trois priorités

> [!argument]
> Les habitants demandent une garantie d’accès à l’eau potable.

> [!argument]
> Les agriculteurs dépendent de l’irrigation.

> [!argument]
> Le tourisme augmente la consommation en été.

> [!speaker-notes]
> Faire réagir la classe avant la diapositive suivante.

---

## Quelle décision prendre ?

> [!question-directrice]
> Quels usages doivent être prioritaires en période de pénurie ?

> [!recommandation]
> Définir des seuils et des priorités avant la crise.
```

## À retenir

La Présentation reste un **rendu du Markdown**, pas un éditeur graphique parallèle.

Écrivez le contenu ; Feuillets prend en charge la composition autant que possible.
