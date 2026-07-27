/** Assemble les notes quotidiennes en un carnet lisible : chaque jour
 * devient une section `## AAAA-MM-JJ`, dans l'ordre fourni (déjà trié par
 * date par l'appelant). Fonction pure — ne lit ni n'écrit rien elle-même,
 * c'est services/journal.js qui fournit `entries` depuis les fichiers. */
type JournalEntry = {
  key: string;
  body: string;
};

export function buildCarnet(entries: JournalEntry[]) {
  return entries.map(({ key, body }) => `## ${key}\n\n${body}`).join("\n\n");
}
