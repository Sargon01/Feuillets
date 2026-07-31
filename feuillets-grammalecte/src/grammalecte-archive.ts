/* Emplacement de l'archive Grammalecte embarquée.
 *
 * Ce fichier est un PLACEHOLDER : au build, esbuild remplace intégralement son
 * contenu par la même constante remplie avec l'archive brotli des ressources,
 * encodée en base64 (voir esbuild.config.mjs et
 * scripts/build-grammalecte-archive.mjs). C'est ce qui permet de livrer un
 * greffon standard — manifest.json + main.js — sans dossier resources/ à
 * copier ni téléchargement.
 *
 * Il reste committé et vide pour deux raisons : le typecheck et les tests
 * fonctionnent sans que les 9 Mo de sources soient présents, et rien
 * d'énorme ni de généré n'entre dans le dépôt. */

export const GRAMMALECTE_ARCHIVE_BASE64 = "";
