Moteur Grammalecte (correcteur grammatical, orthographique et typographique
pour le français), embarqué dans Feuillets.

Source : extension Firefox officielle « Grammalecte by algoo [fr] », version
2.3.1, publiée par Algoo (https://github.com/algoo/grammalecte).
Licence : GPL-3.0 (voir /LICENSE à la racine du dépôt).

Fichiers conservés depuis le paquet d'origine (extraction du .xpi) :
- fr/ : moteur de grammaire (gc_engine.js, gc_functions.js, gc_options.js,
  gc_rules.js, gc_rules_graph.js, cregex.js, conj.js, mfsp.js, phonet.js) et
  leurs données (conj_data.json, mfsp_data.json, phonet_data.json).
- graphspell/ : correcteur orthographique (spellchecker.js, ibdawg.js,
  tokenizer.js, str_transform.js, helpers.js, char_player.js, lexgraph_fr.js)
  et un seul dictionnaire (_dictionaries/fr-classic.json — orthographe
  classique ; les variantes fr-allvars et fr-reform du paquet d'origine n'ont
  pas été conservées).
- text.js : utilitaires de découpage en paragraphes.

Volontairement exclus (spécifiques à l'extension navigateur, inutiles ici) :
panneau HTML/CSS, icônes, polices, fonts Awesome, gce_worker.js (sa logique de
chargement — même ordre, mêmes fichiers — est reprise dans
src/services/grammalecte-checker.js, qui exécute ces fichiers dans un
vm.createContext() partagé au lieu d'un Worker de navigateur avec
importScripts ; tourne directement dans le process d'Obsidian, pas dans un
processus séparé — voir les commentaires en tête de ce fichier).

Modification apportée par rapport à l'original (GPL-3.0 oblige à la
signaler) :
- fr/gc_engine.js, fonction `load()` : le nom du dictionnaire était codé en
  dur ("fr-allvars.json"). Ajout d'un 4e paramètre `sDictionary` (défaut
  "fr-classic.json", seul dictionnaire distribué avec Feuillets) pour ne pas
  charger un fichier absent.
