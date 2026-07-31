# Changelog — Feuillets Grammalecte

Toutes les modifications notables apportées au projet **Feuillets Grammalecte** seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/), et ce projet adhère au versionnage sémantique [Semantic Versioning](https://semver.org/lang/fr/).

---

## [1.0.0] - 2026-07-31

### Ajouté
- **Intégration locale du moteur Grammalecte v2.2.0** :
  - Dictionnaire français classique embarqué sans téléchargement réseau.
  - Évaluation isolée dans un bac à sable `vm` (Node.js) pour préserver l'environnement d'Obsidian.
- **Enregistrement auprès de l'API Feuillets** :
  - Fournisseur linguistique autonome détecté et enregistré dynamiquement.
- **Menu contextuel (clic droit)** :
  - Remplacement direct par les suggestions d'orthographe et de grammaire.
  - Option *Ignorer cette occurrence* (masquage en mémoire pour la session).
  - Option *Apprendre ce mot* (réservée à l'orthographe, persistée dans `data.json`).
- **Soulignements dans l'éditeur** :
  - Vaguelette rouge pour l'orthographe et vaguelette bleue pour la grammaire via CodeMirror 6.
- **Analyse automatique (Debounce)** :
  - Relance automatique après 1 seconde sans frappe lorsque l'onglet Relecture est ouvert.
  - Conservation du focus éditeur et neutralisation des réanalyses sur texte inchangé.
- **Section d'analyse linguistique** :
  - Mesures de richesse lexicale, lemmes, adverbes en *-ment* et voix passive.
