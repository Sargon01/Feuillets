// Fait tourner le moteur Grammalecte directement dans le process d'Obsidian
// (pas de processus séparé : voir la discussion produit — fork() relance
// Obsidian lui-même au lieu de Node sur ce build, worker_threads n'est pas
// supporté par le V8 d'Electron dans le process de rendu des plugins). Le
// calcul est donc synchrone et bloque brièvement l'UI pendant une
// vérification — acceptable puisqu'on ne vérifie qu'à la demande (bouton
// actualiser / changement de feuillet), pas en continu à chaque frappe.
// Desktop uniquement (require("fs")/require("vm") indisponibles sur mobile) :
// à vérifier avec Platform.isMobile avant d'instancier cette classe.
//
// Les fichiers de resources/grammalecte/ sont écrits pour tourner dans le
// scope global partagé d'un vrai Worker de navigateur (importScripts) :
// gc_rules_graph.js appelle par exemple des fonctions définies dans
// gc_functions.js en supposant qu'elles sont globales. require() les
// chargerait comme modules Node isolés et casserait cette hypothèse. On
// reproduit donc ce scope global partagé avec vm, dans le même ordre de
// chargement que le vrai gce_worker.js de Grammalecte.

/* eslint-disable @typescript-eslint/no-require-imports -- require paresseux volontaire : fs/path/vm pour le moteur Grammalecte embarque, desktop uniquement (voir l'en-tete du fichier) */
/* global require -- défini par environnement */
import { grammarIssueSignature } from "../utils/grammar-issue-signature.js";
import { pluginAbsoluteDir } from "../utils/plugin-dir.js";
export { grammarIssueSignature };

type GrammarIssue = {
  type: "grammar" | "spelling";
  start: number;
  end: number;
  ruleId: string;
  message: string;
  suggestions: string[];
  underlined: string;
};

type GrammalecteError = {
  nStart: number;
  nEnd: number;
  sRuleId: string;
  sMessage: string;
  aSuggestions: string[];
  sUnderlined: string;
};

type SpellToken = {
  nStart: number;
  nEnd: number;
  sValue: string;
};

export type SpellChecker = {
  parseParagraph(text: string): Iterable<SpellToken>;
  suggest(word: string): Iterator<string[]>;
  getMorph(word: string): string[];
};

type GrammalecteContext = {
  self: unknown;
  XMLHttpRequest: unknown;
  __dirname: string;
  conj: { init(data: string): void };
  phonet: { init(data: string): void };
  mfsp: { init(data: string): void };
  text: { getParagraph(text: string): Iterable<string> };
  gc_engine: {
    load(language: string, country: string, dictionariesPath: string, dictionaryName: string): void;
    setOption(name: string, value: boolean): void;
    parse(text: string, language: string, debug: boolean, context: null, fullInfo: boolean): Iterable<GrammalecteError>;
    getSpellChecker(): SpellChecker;
  };
};

export class GrammalecteChecker {
  app: unknown;
  manifest: unknown;
  context: GrammalecteContext | null;
  spellChecker: SpellChecker | null;

  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
    this.context = null;
    this.spellChecker = null;
  }

  ensureLoaded(): void {
    if (this.context) return;

    const fs = require("fs");
    const path = require("path");
    const vm = require("vm");
    const grammalecteDir = path.join(pluginAbsoluteDir(this.app, this.manifest), "resources", "grammalecte");

    const context = vm.createContext({ console }) as GrammalecteContext;
    context.self = context;

    // Émulation minimale et synchrone de XMLHttpRequest : helpers.loadFile()
    // s'en sert (branche "navigateur") pour charger le dictionnaire depuis un
    // chemin que nous lui passons nous-mêmes en chemin de fichier absolu.
    context.XMLHttpRequest = function XMLHttpRequest() {
      this.open = (_method, sUrl) => { this._path = sUrl; };
      this.overrideMimeType = () => {};
      this.send = () => { this.responseText = fs.readFileSync(this._path, "utf8"); };
    };

    const loadScript = (...segments: string[]): void => {
      const file = path.join(grammalecteDir, ...segments);
      context.__dirname = path.dirname(file);
      vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
    };

    // Ordre repris de gce_worker.js (extension officielle Firefox/Chrome).
    loadScript("graphspell", "helpers.js");
    loadScript("graphspell", "str_transform.js");
    loadScript("graphspell", "char_player.js");
    loadScript("graphspell", "lexgraph_fr.js");
    loadScript("graphspell", "ibdawg.js");
    loadScript("graphspell", "spellchecker.js");
    loadScript("text.js");
    loadScript("graphspell", "tokenizer.js");
    loadScript("fr", "conj.js");
    loadScript("fr", "mfsp.js");
    loadScript("fr", "phonet.js");
    loadScript("fr", "cregex.js");
    loadScript("fr", "gc_options.js");
    loadScript("fr", "gc_functions.js");
    loadScript("fr", "gc_rules.js");
    loadScript("fr", "gc_rules_graph.js");
    loadScript("fr", "gc_engine.js");

    context.conj.init(fs.readFileSync(path.join(grammalecteDir, "fr", "conj_data.json"), "utf8"));
    context.phonet.init(fs.readFileSync(path.join(grammalecteDir, "fr", "phonet_data.json"), "utf8"));
    context.mfsp.init(fs.readFileSync(path.join(grammalecteDir, "fr", "mfsp_data.json"), "utf8"));
    context.gc_engine.load("JavaScript", "aHSL", path.join(grammalecteDir, "graphspell", "_dictionaries"), "fr-classic.json");

    this.context = context;
    this.spellChecker = context.gc_engine.getSpellChecker();
  }

  // Enveloppé dans un window.setTimeout(0) : laisse le temps au "Vérification en
  // cours…" de s'afficher avant le calcul bloquant (pas de vrai parallélisme
  // possible sans processus séparé, voir le commentaire en tête de fichier).
  // knownWords : mots que l'utilisateur a marqués "appris" (onglet Grammalecte,
  // « Ajouter au dictionnaire ») — jamais signalés comme faute d'orthographe.
  // Comparaison insensible à la casse (accepte "Ezan" en début de phrase pour
  // un mot appris "ezan").
  // ignoredSignatures : signalements de grammaire explicitement ignorés
  // (bouton "Ignorer" de l'onglet), voir grammarIssueSignature().
  // detectRepetitions : active redon1/redon2 (répétitions de mots proches,
  // désactivées par défaut dans Grammalecte lui-même — bruyant).
  checkText(sText: string, knownWords: string[] = [], ignoredSignatures: string[] = [], detectRepetitions = false): Promise<GrammarIssue[]> {
    const lowerKnown = new Set(knownWords.map((w) => w.toLowerCase()));
    const ignored = new Set(ignoredSignatures);
    return new Promise<GrammarIssue[]>((resolve, reject) => {
      window.setTimeout(() => {
        try {
          this.ensureLoaded();
          this.context!.gc_engine.setOption("redon1", detectRepetitions);
          this.context!.gc_engine.setOption("redon2", detectRepetitions);
          resolve(this.runParse(sText, lowerKnown, ignored));
        } catch (e) {
          /* Toujours rejeter avec une Error : le moteur Grammalecte est du
             JS embarqué qui peut lancer une chaîne nue, et un rejet non-Error
             perd la pile à la remontée. */
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }, 0);
    });
  }

  runParse(sText: string, lowerKnown: Set<string>, ignored: Set<string>): GrammarIssue[] {
    const { context, spellChecker } = this;
    const lIssues: GrammarIssue[] = [];
    const sNormalized = sText.replace(/­/g, "").normalize("NFC");
    let iParaStart = 0;

    for (const sParagraph of context!.text.getParagraph(sNormalized)) {
      if (sParagraph.trim() !== "") {
        for (const oErr of context!.gc_engine.parse(sParagraph, "FR", false, null, true)) {
          const issue = {
            type: "grammar" as GrammarIssue["type"],
            start: iParaStart + oErr.nStart,
            end: iParaStart + oErr.nEnd,
            ruleId: oErr.sRuleId,
            message: oErr.sMessage,
            suggestions: oErr.aSuggestions,
            underlined: oErr.sUnderlined,
          };
          if (ignored.has(grammarIssueSignature(issue))) continue;
          lIssues.push(issue);
        }
        for (const oToken of spellChecker!.parseParagraph(sParagraph)) {
          if (lowerKnown.has(oToken.sValue.toLowerCase())) continue;
          lIssues.push({
            type: "spelling" as GrammarIssue["type"],
            start: iParaStart + oToken.nStart,
            end: iParaStart + oToken.nEnd,
            ruleId: "orthographe",
            message: `« ${oToken.sValue} » : mot inconnu du dictionnaire.`,
            suggestions: spellChecker!.suggest(oToken.sValue).next().value || [],
            underlined: oToken.sValue,
          });
        }
      }
      iParaStart += sParagraph.length + 1; // +1 : le séparateur "\n" retiré par getParagraph
    }

    lIssues.sort((a, b) => a.start - b.start);
    return lIssues;
  }

  destroy(): void {
    this.context = null;
    this.spellChecker = null;
  }
}

/* eslint-enable @typescript-eslint/no-require-imports -- fin du bloc require paresseux */
