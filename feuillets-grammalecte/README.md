# Feuillets Grammalecte

**Feuillets Grammalecte** est le greffon compagnon officiel d'analyse linguistique pour le studio d'écriture [Feuillets](https://github.com/Sargon01/Feuillets). Il embarque localement le moteur de correction grammaticale et orthographique **Grammalecte** pour offrir une relecture fluide et confidentielle directement dans Obsidian.

> **Avertissement** : Ce projet est une intégration indépendante développée pour Obsidian et **n'est pas le projet officiel Grammalecte**.

---

## 🎯 Rôle du compagnon et dépendance

Ce greffon fournit un moteur de correction linguistique local qui s'enregistre automatiquement auprès du plugin principal **[Feuillets](https://github.com/Sargon01/Feuillets)**.

- **Dépendance requise** : Le plugin **Feuillets** (v1.5.0 ou supérieure) doit être installé et activé dans Obsidian.
- **Fournisseur autonome** : Feuillets Grammalecte fournit l'analyse linguistique sans ajouter de logique grammaticale lourde dans le cœur de Feuillets.

---

## 🔒 100 % Local et Confidentiel

- **Aucun envoi vers un serveur externe** : Vos manuscrits, romans et notes ne quittent jamais votre ordinateur.
- **Exécution hors ligne** : Le moteur Grammalecte et son dictionnaire français complet sont entièrement embarqués dans le plugin. Aucune connexion internet n'est requise.

---

## ✨ Fonctionnalités

- **Correction orthographique et grammaticale** : Détection des fautes d'orthographe, d'accord, de ponctuation, de typographie et des répétitions.
- **Menu contextuel (clic droit)** :
  - Suggestions de remplacement directes avec remplacement exact du texte.
  - *Ignorer cette occurrence* (masque la faute pour la session en cours).
  - *Apprendre ce mot* (pour les erreurs d'orthographe, avec persistance dans les réglages).
- **Soulignements dans l'éditeur Markdown** :
  - Vaguelette **rouge** pour les erreurs d'orthographe.
  - Vaguelette **bleue** pour les erreurs de grammaire.
- **Analyse automatique temporisée (Debounce)** :
  - Relance automatique de la vérification 1 seconde après la fin de la frappe lorsque l'onglet **Relecture** est ouvert.
  - Ne relance pas l'analyse si le texte n'a pas changé.
  - Portée strictement limitée au feuillet courant (`document`) pour ne jamais ralentir l'application sur le roman entier.
- **Section d'analyse linguistique** :
  - Indicateurs de richesse lexicale, lemmes, adverbes en *-ment*, verbes passifs et longueur moyenne des phrases.

---

## 💻 Installation

### Depuis Obsidian (Recommandé)
1. Ouvrez **Paramètres** > **Plugins tiers**.
2. Recherchez **Feuillets Grammalecte** et cliquez sur **Installer**.
3. Activez le plugin. Assurez-vous que le plugin **Feuillets** est également activé.

### Installation manuelle
1. Téléchargez les fichiers `main.js` et `manifest.json` de la dernière version ([Releases](https://github.com/Sargon01/Feuillets-Grammalecte/releases)).
2. Créez le dossier `.obsidian/plugins/feuillets-grammalecte/` dans votre coffre.
3. Copiez-y `main.js` et `manifest.json`.
4. Rechargez les plugins tiers dans Obsidian et activez **Feuillets Grammalecte**.

---

## ⚠️ Limites connues & Compatibilité

- **Compatibilité Obsidian** : Requièrt Obsidian `v1.7.2` ou supérieure.
- **Desktop uniquement (`isDesktopOnly: true`)** : En raison de l'utilisation du module `vm` de Node.js pour isoler le moteur Grammalecte des prototypes globaux de l'application, ce greffon ne fonctionne que sur la version de bureau (macOS, Windows, Linux) et n'est pas disponible sur mobiles (iOS/Android).

---

## 📜 Licence et Crédits

- **Licence du greffon** : Distribué sous licence **GNU General Public License v3.0** (`GPL-3.0-only`). Voir le fichier [LICENSE](LICENSE).
- **Crédits Grammalecte** : Moteur linguistique développé par **Olivier R.** ([https://grammalecte.net](https://grammalecte.net)).
- Consultez le fichier [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) pour le détail des composants tiers embarqués.
