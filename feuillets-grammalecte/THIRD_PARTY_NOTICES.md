# Notices de composants tiers / Third-Party Notices

Ce projet intègre des ressources et du code sous licence libre provenant du projet **Grammalecte**.

---

## Grammalecte

- **Nom du composant** : Grammalecte
- **Auteur & Copyright** : Olivier R. (Olivier Richard)
- **Site officiel** : [https://grammalecte.net](https://grammalecte.net)
- **Dépôt officiel des sources** : [https://fossil.grammalecte.net](https://fossil.grammalecte.net)
- **Version intégrée** : 2.2.0 (moteur de correction grammaticale et orthographique en JavaScript)
- **Licence** : GNU General Public License v3.0 (GPL-3.0)

### Ressources et fichiers embarqués

Le composant intègre les modules et bases de données linguistiques suivants :
- Moteur de règles grammaticales : `grammalecte/fr/gc_engine.js`, `grammalecte/fr/gc_functions.js`, `grammalecte/fr/gc_rules_graph.js`
- Correcteur orthographique : `grammalecte/graphspell/spellchecker.js`, `grammalecte/graphspell/ibdawg.js`, `grammalecte/graphspell/helpers.js`
- Dictionnaire français classique : `grammalecte/graphspell/_dictionaries/fr-classic.json`
- Données de conjugaison, phonétique et morphosyntaxe : `grammalecte/fr/conj.json`, `grammalecte/fr/phonet.json`, `grammalecte/fr/mfsp.json`

### Adaptations et transformations effectuées

1. **Empaquetage en archive embarquée** :
   Les 21 fichiers sources et dictionnaires du moteur Grammalecte sont compressés sous forme d'une archive JSON Base64 (`src/grammalecte-assets.ts`) intégrée directement lors de la phase de build (`esbuild`). Aucun téléchargement réseau ni accès disque n'est requis à l'exécution.

2. **Isolation dans un bac à sable `vm` (Node.js)** :
   Le moteur Grammalecte est évalué au sein d'un contexte isolé `vm.createContext()` afin de ne pas polluer les prototypes globaux (`String.prototype`, `RegExp.prototype`) de l'application Obsidian.

---

Avis légal : Ce greffon compagnon est un projet indépendant distribué sous licence GNU GPLv3. Il n'est pas édité par l'équipe officielle de Grammalecte.
