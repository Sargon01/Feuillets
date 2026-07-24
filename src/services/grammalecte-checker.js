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

// Signature d'un signalement de grammaire pour la liste "fautes ignorées" :
// règle + mot concerné (insensible à la casse) — assez précis pour ne pas
// masquer la même règle sur un mot différent, assez large pour couvrir la
// même tournure répétée ailleurs dans le texte.
export function grammarIssueSignature(issue) {
  return `${issue.ruleId}::${(issue.underlined || "").toLowerCase()}`;
}

function pluginAbsoluteDir(app, manifest) {
  const path = require("path");
  const basePath = app.vault.adapter.getBasePath
    ? app.vault.adapter.getBasePath()
    : app.vault.adapter.basePath;
  return path.join(basePath, manifest.dir);
}

export class GrammalecteChecker {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this.context = null;
    this.spellChecker = null;
  }

  ensureLoaded() {
    if (this.context) return;

    const fs = require("fs");
    const path = require("path");
    const vm = require("vm");
    const grammalecteDir = path.join(pluginAbsoluteDir(this.app, this.manifest), "resources", "grammalecte");

    const context = vm.createContext({ console });
    context.self = context;

    // Émulation minimale et synchrone de XMLHttpRequest : helpers.loadFile()
    // s'en sert (branche "navigateur") pour charger le dictionnaire depuis un
    // chemin que nous lui passons nous-mêmes en chemin de fichier absolu.
    context.XMLHttpRequest = function XMLHttpRequest() {
      this.open = (_method, sUrl) => { this._path = sUrl; };
      this.overrideMimeType = () => {};
      this.send = () => { this.responseText = fs.readFileSync(this._path, "utf8"); };
    };

    const loadScript = (...segments) => {
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

  // Enveloppé dans un setTimeout(0) : laisse le temps au "Vérification en
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
  checkText(sText, knownWords = [], ignoredSignatures = [], detectRepetitions = false) {
    const lowerKnown = new Set(knownWords.map((w) => w.toLowerCase()));
    const ignored = new Set(ignoredSignatures);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          this.ensureLoaded();
          this.context.gc_engine.setOption("redon1", detectRepetitions);
          this.context.gc_engine.setOption("redon2", detectRepetitions);
          resolve(this.runParse(sText, lowerKnown, ignored));
        } catch (e) {
          reject(e);
        }
      }, 0);
    });
  }

  runParse(sText, lowerKnown, ignored) {
    const { context, spellChecker } = this;
    const lIssues = [];
    const sNormalized = sText.replace(/­/g, "").normalize("NFC");
    let iParaStart = 0;

    for (const sParagraph of context.text.getParagraph(sNormalized)) {
      if (sParagraph.trim() !== "") {
        for (const oErr of context.gc_engine.parse(sParagraph, "FR", false, null, true)) {
          const issue = {
            type: "grammar",
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
        for (const oToken of spellChecker.parseParagraph(sParagraph)) {
          if (lowerKnown.has(oToken.sValue.toLowerCase())) continue;
          lIssues.push({
            type: "spelling",
            start: iParaStart + oToken.nStart,
            end: iParaStart + oToken.nEnd,
            ruleId: "orthographe",
            message: `« ${oToken.sValue} » : mot inconnu du dictionnaire.`,
            suggestions: spellChecker.suggest(oToken.sValue).next().value || [],
            underlined: oToken.sValue,
          });
        }
      }
      iParaStart += sParagraph.length + 1; // +1 : le séparateur "\n" retiré par getParagraph
    }

    lIssues.sort((a, b) => a.start - b.start);
    return lIssues;
  }

  destroy() {
    this.context = null;
    this.spellChecker = null;
  }
}
