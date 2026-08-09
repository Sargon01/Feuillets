# Sécurité et ressources externes — notes de revue

> Document destiné aux mainteneurs et aux relecteurs de code.

## Résumé

| Capacité | État actuel |
|---|---|
| Télémétrie / analytics | **Non** |
| Envoi du manuscrit vers un service Feuillets | **Non** |
| Code téléchargé puis exécuté | **Non** |
| Moteur grammatical embarqué | **Non** |
| Pandoc / processus de conversion externe | **Non dans le pipeline actuel** |
| Export DOCX/EPUB/ODT | Local |
| Export PDF | Local, via impression système sur desktop |
| Import Scrivener | Action explicite de l’utilisateur |
| Import/révision DOCX | Action explicite de l’utilisateur |
| Sauvegarde ZIP | Locale dans le projet |
| Fournisseur linguistique compagnon | Plugin séparé, enregistré via API |

## Pas de service distant requis

Les fonctions principales — écrire, organiser, rechercher dans le projet, calculer le contexte, analyser la prose, compiler et exporter — ne dépendent pas d’un serveur Feuillets.

Le manuscrit n’est pas envoyé à un service distant par le noyau.

Les liens présents dans la documentation ou les interfaces ne deviennent une navigation web que si l’utilisateur les ouvre explicitement.

## Pas de moteur grammatical dans le noyau

Feuillets expose `src/api/text-analysis.ts`.

Un autre plugin installé dans le même environnement Obsidian peut s’enregistrer comme `TextAnalysisProvider`.

Le noyau :

- valide la forme du fournisseur ;
- lui remet le texte demandé lorsqu’une analyse est déclenchée ;
- valide les plages retournées ;
- affiche les signalements.

Le comportement réseau éventuel d’un compagnon relève de ce compagnon, pas du noyau Feuillets.

## Dépendances runtime

Les dépendances applicatives principales du `package.json` courant sont :

- `docx` ;
- `jszip` ;
- `diff`.

Elles servent respectivement à la génération documentaire, aux conteneurs ZIP et aux comparaisons.

Voir `../THIRD_PARTY_NOTICES.md`.

## Import Scrivener

L’importeur travaille à partir d’éléments choisis par l’utilisateur :

- fichiers fournis à l’interface ;
- entrées de dossier exposées par l’environnement ;
- archive ZIP compatible.

Le contenu est lu pour produire les fichiers du projet dans le coffre.

Il n’existe pas de parcours normal où Feuillets scanne en arrière-plan un disque externe à la recherche de projets Scrivener.

## Révision DOCX

Le retour DOCX est également une action explicite.

Le risque principal n’est pas un accès réseau : c’est l’application incorrecte d’une révision au mauvais passage.

C’est pourquoi le flux conserve des états d’ambiguïté et une décision de l’auteur plutôt que de forcer les correspondances incertaines.

## Écriture dans le coffre

Feuillets doit pouvoir créer et modifier des fichiers car c’est son rôle.

Exemples :

- feuillets du manuscrit ;
- Recherche ;
- Ressources ;
- pages Front ;
- `_Snapshots` ;
- `_Versions` ;
- `_Backups` ;
- `_Edition` ;
- `_Journal` ;
- `_Sortie`.

Une opération qui crée ces dossiers doit respecter la racine du projet actif et ne pas transformer la racine du coffre en projet technique par accident.

## Sauvegarde : frontière de sécurité

`services/project-backup.ts` distingue deux cas :

### `Manuscrit` structuré

La racine de sauvegarde peut remonter au parent réel du dossier `Manuscrit`.

### Dossier utilisé tel quel

La racine de sauvegarde reste ce dossier.

Cette règle évite d’inclure les frères du projet dans le ZIP.

`_Backups` est exclu de sa propre archive.

## `_Sortie`

Le même principe de frontière s’applique au dossier de sortie :

- frère de `Manuscrit` dans un projet structuré ;
- enfant direct du projet utilisé tel quel.

## PDF

`services/export-pdf.ts` utilise l’environnement DOM pour construire un document d’impression séparé.

Sur mobile, l’export PDF s’arrête explicitement.

Sur desktop, l’utilisateur choisit ensuite l’action d’enregistrement PDF dans la boîte d’impression du système.

Aucun service de conversion PDF externe n’est requis.

## Documents HTML temporaires

Les zones d’export qui doivent construire un document distinct de la page Obsidian utilisent un iframe/document séparé et des API DOM adaptées à ce document.

Cette exception technique ne doit pas être copiée dans les vues normales pour contourner les règles de création DOM d’Obsidian.

## Code de production

Le bundle est généré depuis `src/main.ts` avec esbuild et reste non minifié.

Les modules hôtes tels qu’Obsidian sont externes au bundle conformément à la configuration de build.

## Version Obsidian

Le manifeste courant demande :

```text
minAppVersion: 1.13.0
```

Les justifications documentaires basées sur une compatibilité 1.7.x ou 1.12.x sont donc obsolètes et ne doivent plus guider le code courant.

## Contrôles

Commandes importantes :

```bash
npm test
npm run build
npm run lint
npm run lint:obsidian
```

La CI doit continuer à exécuter la revue Obsidian afin qu’une nouvelle utilisation d’API risquée ne soit pas découverte seulement après publication.

## Revue d’une nouvelle dépendance

Avant d’ajouter une dépendance runtime, vérifier :

1. pourquoi le code existant ne suffit pas ;
2. taille et licence ;
3. activité réseau ;
4. code dynamique ;
5. APIs Node/Electron ;
6. comportement mobile ;
7. impact sur la revue Obsidian ;
8. nécessité de mettre à jour `PRIVACY.md`, `SECURITY.md` et `THIRD_PARTY_NOTICES.md`.

## Principe

> Une capacité système n’est pas problématique parce qu’elle existe ; elle doit être explicite, bornée au besoin de l’utilisateur et absente des chemins où elle n’a rien à faire.
