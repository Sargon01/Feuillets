/* eslint-disable @typescript-eslint/no-require-imports -- require paresseux volontaire : path, charge seulement quand le moteur Harper local est sollicite */
/* global require -- défini par environnement */
import { createBinaryModuleFromUrl, LocalLinter, Dialect } from "harper.js";
import { grammarIssueSignature } from "../utils/grammar-issue-signature.js";
import { pluginAbsoluteDir } from "../utils/plugin-dir.js";

type GrammarIssue = {
  type: "spelling" | "grammar";
  ruleId: string;
  message: string;
  start: number;
  end: number;
  offset: number;
  length: number;
  underlined: string;
  suggestions: string[];
};

// Catégories Harper que l'UI Feuillets traite comme fautes d'orthographe —
// tout le reste est classé "grammar" (voir lintKindColor.ts du plugin
// Harper officiel pour la liste complète des lint_kind() possibles).
const SPELLING_KINDS = new Set(["Spelling", "Typo"]);

export class HarperChecker {
  app: unknown;
  manifest: unknown;
  linter: LocalLinter | null;
  importedWords: Set<string>;

  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
    this.linter = null;
    this.importedWords = new Set<string>();
  }

  ensureLoaded(): void {
    if (this.linter) return;

    const path = require("path");
    const wasmPath = path.join(pluginAbsoluteDir(this.app, this.manifest), "resources", "harper", "harper_wasm_slim_bg.wasm");
    // file:// + process défini (Electron/Node) : la lib lit le binaire via
    // fs.readFile en interne, aucun fetch réseau — voir BinaryModule-*.js
    // (getInitInput) dans harper.js.
    const binary = createBinaryModuleFromUrl(`file://${wasmPath}`, "slim");
    this.linter = new LocalLinter({ binary, dialect: Dialect.American });
  }

  // knownWords : mots à ne jamais signaler comme fautes d'orthographe
  // (dictionnaire personnalisé Harper — importWords est cumulatif, on ne
  // réimporte que les mots pas déjà connus). ignoredSignatures : voir
  // grammarIssueSignature (lint_kind()::mot).
  async checkText(sText: string, knownWords: string[] = [], ignoredSignatures: string[] = []): Promise<GrammarIssue[]> {
    this.ensureLoaded();
    const linter = this.linter!;
    await linter.setup();

    const newWords = knownWords.filter((w) => !this.importedWords.has(w.toLowerCase()));
    if (newWords.length > 0) {
      await linter.importWords(newWords);
      for (const w of newWords) this.importedWords.add(w.toLowerCase());
    }

    const ignored = new Set(ignoredSignatures);
    const lints = await linter.lint(sText);
    const issues: GrammarIssue[] = [];

    for (const lint of lints) {
      const span = lint.span();
      const kind = lint.lint_kind();
      const underlined = lint.get_problem_text();
      const issue = {
        /* eslint signale ce cast comme superflu, mais le retirer élargit
           `type` en `string` et casse tsc (GrammarIssue["type"] attendu) —
           faux positif du linter, vérifié avec `tsc` seul. Conservé. */
        type: (SPELLING_KINDS.has(kind) ? "spelling" : "grammar") as GrammarIssue["type"],
        ruleId: kind,
        message: lint.message(),
        start: span.start,
        end: span.end,
        offset: span.start,
        length: span.end - span.start,
        underlined,
        suggestions: lint
          .suggestions()
          .map((s) => s.get_replacement_text())
          .filter((t) => t.length > 0),
      };

      if (ignored.has(grammarIssueSignature(issue))) continue;
      issues.push(issue);
    }

    issues.sort((a, b) => a.start - b.start);
    return issues;
  }

  destroy(): void {
    this.linter = null;
    this.importedWords.clear();
  }
}

/* eslint-enable @typescript-eslint/no-require-imports -- fin du bloc require paresseux */
