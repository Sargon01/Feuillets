# Relecture collaborative

> **Français** · [English](COLLABORATIVE-REVIEW.md) · [Index](README.md)

La **Relecture collaborative** permet d’échanger un manuscrit avec une autre personne sans convertir le projet en DOCX et sans lui transmettre tout le coffre Obsidian.

Le transport est un fichier `.feuillets` créé explicitement par l’utilisateur.

## Côté auteur : créer la relecture

Dans **Relecture → Relecture collaborative** :

1. choisissez **Nouvelle relecture** ;
2. indiquez le nom de l’auteur et du relecteur ;
3. choisissez la portée : **ce feuillet**, **ce dossier** ou **projet entier** ;
4. créez et téléchargez le paquet `.feuillets` ;
5. envoyez ce fichier au relecteur par le moyen de votre choix.

La session locale garde l’état du texte envoyé afin que le retour puisse être analysé plus tard.

## Côté relecteur

Le relecteur installe Feuillets, ouvre **Relecture collaborative** et importe le paquet reçu.

Feuillets crée une copie de travail locale liée à cette relecture. Le relecteur peut :

- modifier le texte de travail ;
- sélectionner un passage et **ajouter une note** ;
- naviguer dans les documents de la portée ;
- renvoyer le résultat à l’auteur sous forme d’un nouveau paquet `.feuillets`.

Le reste du coffre de l’auteur n’est pas contenu dans le paquet.

## Côté auteur : traiter le retour

L’auteur importe le retour. Feuillets effectue une comparaison à trois états :

1. texte envoyé au relecteur ;
2. version modifiée par le relecteur ;
3. manuscrit actuel de l’auteur.

Cette analyse évite d’écraser silencieusement un passage que l’auteur aurait lui-même modifié pendant la relecture.

Les propositions apparaissent dans le comparateur. Selon le cas, l’auteur peut :

- **Appliquer** ;
- **Ignorer** ;
- traiter manuellement un passage en conflit ;
- lire et marquer les notes comme traitées.

## Plusieurs feuillets et plusieurs tours

Une relecture peut couvrir plusieurs feuillets ; chacun conserve son propre accès et son propre état de traitement.

Après un retour, l’auteur peut poursuivre l’échange. Les fils de notes sont conservés dans la session afin qu’une discussion puisse continuer sur plusieurs tours.

## Finir ou archiver

Une relecture terminée peut être archivée localement. Supprimer une session de relecture ne revient pas sur les modifications déjà appliquées au manuscrit.

## Relecture collaborative ou Révision DOCX ?

Utilisez **Relecture collaborative** lorsque les deux personnes travaillent avec Feuillets et souhaitent un échange natif Markdown/Feuillets.

Utilisez **Révision DOCX** lorsqu’un éditeur ou correcteur travaille dans Word avec suivi des modifications et commentaires.
