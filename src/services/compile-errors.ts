/** Erreur de compilation/export contextualisée : jamais juste « Échec de
 * l'export » — toujours l'étape, le fichier concerné (si connu) et le
 * format visé (si connu). Une erreur dans UN feuillet doit rester attribuée
 * à CE feuillet, pas donner l'impression d'un problème sur tout le projet.
 *
 * Volontairement une seule petite classe plutôt qu'une hiérarchie : les
 * "étapes" sont des chaînes libres (pas un enum fermé) parce que chaque
 * exporteur ajoute les siennes au fil du temps sans avoir à toucher ce
 * fichier — voir les appels dans compile-export.ts/export-render.ts pour la
 * liste réelle utilisée aujourd'hui ("lecture du feuillet", "rendu Markdown",
 * "compilation", "export docx"...). */
export class CompileError extends Error {
  /** Étape où l'erreur est survenue, en clair (ex. "lecture du feuillet"). */
  step: string;
  /** Chemin du feuillet en cause, si l'erreur est attribuable à un fichier précis. */
  filePath?: string;
  /** Format d'export visé, si l'erreur survient après le choix du format. */
  format?: string;

  /** Erreur d'origine, si celle-ci enveloppe une exception levée plus bas
   *  (lecture de fichier, rendu…). Propriété dédiée plutôt que l'option
   *  `cause` du constructeur natif : ce projet cible `lib: ES2019`. */
  sourceError?: unknown;

  constructor(step: string, message: string, options: { filePath?: string; format?: string; cause?: unknown } = {}) {
    super(message);
    this.name = "CompileError";
    this.step = step;
    this.filePath = options.filePath;
    this.format = options.format;
    this.sourceError = options.cause;
  }

  /** Message complet destiné à l'utilisatrice (Notice) : étape + fichier +
   *  format, quand ils sont connus — jamais un simple "Échec". */
  describe(): string {
    const parts: string[] = [this.step];
    if (this.format) parts.push(`(${this.format})`);
    if (this.filePath) parts.push(`— ${this.filePath}`);
    return `${parts.join(" ")} : ${this.message}`;
  }
}

/** Convertit n'importe quelle valeur jetée en CompileError, en la
 *  rattachant à `step`/`filePath`/`format` si elle n'en a pas déjà (une
 *  CompileError levée plus bas dans la pile garde SES PROPRES étape/fichier
 *  — plus précis que celui de l'appelant — jamais écrasés ici). */
export function toCompileError(
  error: unknown,
  step: string,
  options: { filePath?: string; format?: string } = {}
): CompileError {
  if (error instanceof CompileError) {
    return new CompileError(error.step, error.message, {
      filePath: error.filePath ?? options.filePath,
      format: error.format ?? options.format,
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CompileError(step, message, { ...options, cause: error });
}
