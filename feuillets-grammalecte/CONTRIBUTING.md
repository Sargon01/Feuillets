# Guide de contribution — Feuillets Grammalecte

Merci de votre intérêt pour contribuer au projet **Feuillets Grammalecte** !

## 🛠️ Développement local

### Prérequis
- Node.js v18 ou supérieure
- npm v9 ou supérieure
- Une copie locale du dépôt [Feuillets](https://github.com/Sargon01/Feuillets)

### Installation et initialisation
1. Clonez ce dépôt.
2. Installez les dépendances de développement :
   ```bash
   npm install
   ```
3. Restaurez les ressources linguistiques embarquées (si nécessaire) :
   ```bash
   npm run resources
   ```

### Commandes utiles
- **Vérification du typage et du style (linter)** :
  ```bash
  npm run lint
  ```
- **Lancement des tests unitaires** :
  ```bash
  npm test
  ```
- **Compilation de production** :
  ```bash
  npm run build
  ```

---

## 📜 Règles de soumission

- Assurez-vous que `npm run lint` et `npm test` s'exécutent avec **0 erreur**.
- Respectez la licence GNU GPLv3 du projet.
