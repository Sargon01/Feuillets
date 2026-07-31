/* Adaptateur Grammalecte : c'est le SEUL fichier qui connaît le moteur.
 *
 * Chargement — repris de l'ancien src/services/grammalecte-checker.ts de
 * Feuillets (supprimé en 1.4.5, commit c799d1c) : les fichiers du moteur sont
 * écrits pour tourner dans le scope global partagé d'un Worker de navigateur
 * (importScripts). gc_rules_graph.js appelle par exemple des fonctions
 * définies dans gc_functions.js en les supposant globales : les charger comme
 * modules isolés casserait cette hypothèse. On reproduit donc ce scope global
 * partagé avec `vm`, dans le même ordre que le gce_worker.js officiel.
 *
 * Les sources ne sont PAS concaténées dans le scope du greffon : chaque
 * fichier est évalué dans un contexte `vm` dédié. C'est ce qui isole
 * Grammalecte du reste d'Obsidian — il étend String.prototype et
 * RegExp.prototype, ce qui polluerait l'application entière s'il tournait
 * dans notre realm.
 *
 * Les ressources arrivent en mémoire (voir grammalecte-assets.ts) : ni
 * lecture disque, ni réseau. Desktop uniquement tout de même, `vm` étant un
 * module Node — d'où isDesktopOnly dans le manifest. Le calcul est synchrone
 * et bloque brièvement l'interface : acceptable puisqu'on n'analyse qu'à la
 * demande, jamais à la frappe. */

/* eslint-disable @typescript-eslint/no-require-imports -- require paresseux volontaire : vm, desktop uniquement (voir l'en-tête du fichier) */
/* global require -- fourni par l'environnement Electron */

import type { TextAnalysisIssue } from "./feuillets-api.ts";
import type { AssetMap } from "./grammalecte-assets.ts";

/** Un signalement de grammaire tel que Grammalecte le rend. */
export type GrammalecteError = {
  nStart: number;
  nEnd: number;
  sRuleId: string;
  sMessage: string;
  aSuggestions: string[];
  sUnderlined: string;
};

/** Un mot inconnu du dictionnaire, tel que le correcteur orthographique le rend. */
export type GrammalecteSpellToken = {
  nStart: number;
  nEnd: number;
  sValue: string;
};

export type GrammalecteEngine = {
  paragraphs(text: string): Iterable<string>;
  setOption(name: string, value: boolean): void;
  parse(paragraph: string): Iterable<GrammalecteError>;
  spell(paragraph: string): Iterable<GrammalecteSpellToken>;
  suggest(word: string): string[];
  getMorph?(word: string): string[];
};

/* ------------------------- conversion (pure) ------------------------- */

export const CATEGORY_GRAMMAR = "Grammaire";
export const CATEGORY_SPELLING = "Orthographe";

function limit(suggestions: string[] | undefined, maxSuggestions: number): string[] | undefined {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return undefined;
  return maxSuggestions > 0 ? suggestions.slice(0, maxSuggestions) : undefined;
}

/* Signature stable d'un signalement (règle + mot concerné, insensible à la
   casse) — reprise de l'ancien utils/grammar-issue-signature.ts. Feuillets ne
   l'interprète pas ; elle sert au compagnon, et à identifier un signalement
   d'une analyse à l'autre. */
function signature(ruleId: string, underlined: string): string {
  return `${ruleId}::${(underlined || "").toLowerCase()}`;
}

/** Erreur de grammaire Grammalecte -> signalement générique Feuillets.
 *  `paragraphOffset` ramène les offsets du paragraphe à ceux du texte
 *  complet transmis par Feuillets. */
export function grammarErrorToIssue(
  error: GrammalecteError,
  paragraphOffset: number,
  maxSuggestions: number
): TextAnalysisIssue {
  return {
    id: signature(error.sRuleId, error.sUnderlined),
    message: error.sMessage,
    category: CATEGORY_GRAMMAR,
    severity: "warning",
    start: paragraphOffset + error.nStart,
    end: paragraphOffset + error.nEnd,
    suggestions: limit(error.aSuggestions, maxSuggestions),
    ruleId: error.sRuleId,
    text: error.sUnderlined,
  };
}

/** Mot inconnu du dictionnaire -> signalement générique Feuillets. */
export function spellTokenToIssue(
  token: GrammalecteSpellToken,
  suggestions: string[],
  paragraphOffset: number,
  maxSuggestions: number
): TextAnalysisIssue {
  return {
    id: signature("orthographe", token.sValue),
    message: `« ${token.sValue} » : mot inconnu du dictionnaire.`,
    category: CATEGORY_SPELLING,
    severity: "error",
    start: paragraphOffset + token.nStart,
    end: paragraphOffset + token.nEnd,
    suggestions: limit(suggestions, maxSuggestions),
    ruleId: "orthographe",
    text: token.sValue,
    canLearn: true,
  };
}

export type AnalyseOptions = {
  checkSpelling: boolean;
  detectRepetitions: boolean;
  maxSuggestions: number;
};

/** Analyse un texte entier, paragraphe par paragraphe, et rend des
 *  signalements dont les offsets sont ceux du texte reçu.
 *
 *  Le texte n'est ni normalisé (NFC) ni nettoyé de ses traits d'union
 *  conditionnels, contrairement à l'ancienne intégration : ces deux
 *  transformations changent la longueur de la chaîne et décalaient donc
 *  silencieusement les offsets rendus à Feuillets. Un signalement bien placé
 *  vaut mieux qu'un signalement légèrement meilleur mais mal ancré. */
export function analyseWithEngine(
  engine: GrammalecteEngine,
  text: string,
  options: AnalyseOptions
): TextAnalysisIssue[] {
  engine.setOption("redon1", options.detectRepetitions);
  engine.setOption("redon2", options.detectRepetitions);

  const issues: TextAnalysisIssue[] = [];
  let paragraphOffset = 0;

  for (const paragraph of engine.paragraphs(text)) {
    if (paragraph.trim() !== "") {
      for (const error of engine.parse(paragraph)) {
        issues.push(grammarErrorToIssue(error, paragraphOffset, options.maxSuggestions));
      }
      if (options.checkSpelling) {
        for (const token of engine.spell(paragraph)) {
          issues.push(
            spellTokenToIssue(token, engine.suggest(token.sValue), paragraphOffset, options.maxSuggestions)
          );
        }
      }
    }
    // +1 : le séparateur "\n" que getParagraph() a retiré.
    paragraphOffset += paragraph.length + 1;
  }

  issues.sort((a, b) => a.start - b.start || a.end - b.end);
  return issues;
}

/* --------------------- chargement du moteur (vm) --------------------- */

/** Fichier-clé vérifié avant de tenter le chargement : c'est lui qui dit si
 *  resources/grammalecte/ a bien été déposé à côté du greffon. */
export const RESOURCE_MARKER = "graphspell/_dictionaries/fr-classic.json";

type SpellChecker = {
  parseParagraph(text: string): Iterable<GrammalecteSpellToken>;
  suggest(word: string): { next(): { value?: string[] } };
  getMorph?(word: string): string[];
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
    parse(
      text: string,
      language: string,
      debug: boolean,
      context: null,
      fullInfo: boolean
    ): Iterable<GrammalecteError>;
    getSpellChecker(): SpellChecker;
  };
};

/* Ordre repris de gce_worker.js (extension officielle Firefox/Chrome) : les
   fichiers se référencent entre eux par variables globales, l'ordre compte.
   Chemins tels qu'ils figurent dans l'archive embarquée. */
const LOAD_ORDER = [
  "graphspell/helpers.js",
  "graphspell/str_transform.js",
  "graphspell/char_player.js",
  "graphspell/lexgraph_fr.js",
  "graphspell/ibdawg.js",
  "graphspell/spellchecker.js",
  "text.js",
  "graphspell/tokenizer.js",
  "fr/conj.js",
  "fr/mfsp.js",
  "fr/phonet.js",
  "fr/cregex.js",
  "fr/gc_options.js",
  "fr/gc_functions.js",
  "fr/gc_rules.js",
  "fr/gc_rules_graph.js",
  "fr/gc_engine.js",
];

/** Fichiers de données chargés après les scripts. */
const DATA_FILES = {
  conj: "fr/conj_data.json",
  phonet: "fr/phonet_data.json",
  mfsp: "fr/mfsp_data.json",
} as const;

/** Dictionnaire principal, réclamé par le moteur via son faux XHR. */
const DICTIONARY_DIR = "graphspell/_dictionaries";
const DICTIONARY_FILE = "fr-classic.json";

/* Le moteur construit lui-même l'URL du dictionnaire (`sPath + "/" + nom`,
   voir ibdawg.js) et la passe à son XMLHttpRequest. On lui donne donc un
   préfixe qui n'est PAS un chemin disque : rien de ce qu'il demandera ne
   pourra sortir de l'archive en mémoire. */
const ASSET_URL_PREFIX = "grammalecte-asset:/";

export class GrammalecteEngineError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GrammalecteEngineError";
  }
}

function assetOrThrow(assets: AssetMap, name: string): string {
  const content = assets.get(name);
  if (content === undefined) {
    throw new GrammalecteEngineError(`Ressource Grammalecte manquante dans l'archive : ${name}.`);
  }
  return content;
}

/** Monte le moteur dans un contexte `vm` neuf à partir des ressources
 *  fournies en mémoire. Opération lourde (9,3 Mo évalués) : n'est appelée
 *  qu'à la première analyse, jamais au démarrage d'Obsidian — voir
 *  GrammalecteProvider.ensureEngine(). */
export function loadGrammalecteEngine(assets: AssetMap): GrammalecteEngine {
  const vm = require("vm") as typeof import("vm");

  /* Contexte neuf : son realm a ses propres String.prototype et
     RegExp.prototype. Les extensions que Grammalecte y ajoute (gl_count,
     gl_startsWith…) restent dedans et n'atteignent jamais Obsidian. */
  const context = vm.createContext({ console }) as GrammalecteContext;
  context.self = context;

  /* Faux XMLHttpRequest, synchrone : c'est par là que helpers.loadFile()
     (branche « navigateur ») réclame le dictionnaire. Il ne sait que lire
     l'archive en mémoire — ni fichier, ni réseau, quelle que soit l'URL
     demandée. */
  context.XMLHttpRequest = function XMLHttpRequest(this: {
    _name?: string;
    responseText?: string;
    open?: (method: string, url: string) => void;
    overrideMimeType?: () => void;
    send?: () => void;
  }) {
    this.open = (_method: string, url: string) => {
      this._name = url.startsWith(ASSET_URL_PREFIX) ? url.slice(ASSET_URL_PREFIX.length) : url;
    };
    this.overrideMimeType = () => {};
    this.send = () => {
      this.responseText = assetOrThrow(assets, this._name || "");
    };
  };

  try {
    for (const name of LOAD_ORDER) {
      context.__dirname = `${ASSET_URL_PREFIX}${name.split("/").slice(0, -1).join("/")}`;
      vm.runInContext(assetOrThrow(assets, name), context, { filename: `grammalecte/${name}` });
    }

    context.conj.init(assetOrThrow(assets, DATA_FILES.conj));
    context.phonet.init(assetOrThrow(assets, DATA_FILES.phonet));
    context.mfsp.init(assetOrThrow(assets, DATA_FILES.mfsp));
    context.gc_engine.load("JavaScript", "aHSL", `${ASSET_URL_PREFIX}${DICTIONARY_DIR}`, DICTIONARY_FILE);
  } catch (error) {
    if (error instanceof GrammalecteEngineError) throw error;
    throw new GrammalecteEngineError(
      `Initialisation du moteur Grammalecte impossible : ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  const spellChecker = context.gc_engine.getSpellChecker();
  if (!spellChecker) {
    throw new GrammalecteEngineError(
      "Le dictionnaire Grammalecte n'a pas pu être chargé (correcteur orthographique absent)."
    );
  }

  return {
    paragraphs: (text) => context.text.getParagraph(text),
    setOption: (name, value) => context.gc_engine.setOption(name, value),
    parse: (paragraph) => context.gc_engine.parse(paragraph, "FR", false, null, true),
    spell: (paragraph) => spellChecker.parseParagraph(paragraph),
    suggest: (word) => spellChecker.suggest(word).next().value || [],
    getMorph: (word) => (typeof spellChecker.getMorph === "function" ? spellChecker.getMorph(word) : []),
  };
}

function lemmaOfMorph(morph: string): string {
  const m = morph.match(/>([0-9a-zà-öø-ÿ-]+)/i);
  return m ? m[1] : "";
}

const VERBES_PASSE_PARTOUT = new Set([
  "être", "avoir", "faire", "dire", "aller", "voir", "mettre", "prendre",
  "donner", "trouver", "passer", "rendre", "tenir", "venir",
]);

const ETRE_INTRANSITIFS = new Set([
  "aller", "arriver", "décéder", "demeurer", "descendre", "devenir", "entrer",
  "intervenir", "monter", "mourir", "naître", "partir", "parvenir", "passer",
  "provenir", "rentrer", "repartir", "rester", "retomber", "retourner",
  "revenir", "sortir", "survenir", "tomber", "venir",
]);

export function analyzeLinguisticsWithEngine(
  engine: GrammalecteEngine,
  text: string
): import("./feuillets-api.ts").LinguisticAnalysisResult | null {
  if (!text || text.trim() === "" || typeof engine.getMorph !== "function") {
    return null;
  }

  const rawWords = text.toLowerCase().match(/[\p{L}][\p{L}'-]{1,}/gu) || [];
  if (rawWords.length === 0) return null;

  const freq = new Map<string, number>();
  for (const w of rawWords) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  const verbs = new Map<string, number>();
  const adjs = new Map<string, number>();
  const advs = new Map<string, number>();
  const allLemmas = new Map<string, number>();
  const ment = new Map<string, number>();
  const categories: Record<string, number> = { Verbe: 0, Nom: 0, Adjectif: 0, Adverbe: 0 };
  let contentTotal = 0;

  const bump = (map: Map<string, number>, lemma: string, n: number) => {
    if (lemma) map.set(lemma, (map.get(lemma) || 0) + n);
  };

  const morphCache = new Map<string, string[]>();
  const morphsOf = (word: string): string[] => {
    if (!morphCache.has(word)) {
      morphCache.set(word, engine.getMorph!(word) || []);
    }
    return morphCache.get(word)!;
  };

  for (const [word, n] of freq) {
    const morphs = morphsOf(word);
    if (!morphs.length) continue;
    let lv = "";
    let la = "";
    let lw = "";
    let lany = "";
    let content = false;

    for (const mo of morphs) {
      if (/:V/.test(mo)) {
        lv = lv || lemmaOfMorph(mo);
        categories.Verbe += n;
      }
      if (mo.includes(":N")) {
        categories.Nom += n;
      }
      if (mo.includes(":A")) {
        la = la || lemmaOfMorph(mo);
        categories.Adjectif += n;
      }
      if (mo.includes(":W")) {
        lw = lw || lemmaOfMorph(mo);
        categories.Adverbe += n;
      }
      if (/:[NAVW]/.test(mo)) {
        content = true;
        lany = lany || lemmaOfMorph(mo);
      }
    }

    bump(verbs, lv, n);
    bump(adjs, la, n);
    bump(advs, lw, n);
    if (content) {
      contentTotal += n;
      if (lany) allLemmas.set(lany, (allLemmas.get(lany) || 0) + n);
    }
    if (lw && word.length > 5 && word.endsWith("ment")) {
      ment.set(word, (ment.get(word) || 0) + n);
    }
  }

  // Voix passive
  const isEtre = (w: string) => morphsOf(w).some((mo) => /:V/.test(mo) && lemmaOfMorph(mo) === "être");
  const ppLemma = (w: string): string => {
    for (const mo of morphsOf(w)) {
      if (/:V/.test(mo) && mo.includes(":Q")) return lemmaOfMorph(mo);
    }
    return "";
  };

  let passiveCount = 0;
  for (let i = 0; i < rawWords.length; i++) {
    if (!isEtre(rawWords[i])) continue;
    const end = Math.min(i + 2, rawWords.length - 1);
    for (let j = i + 1; j <= end; j++) {
      const pl = ppLemma(rawWords[j]);
      if (pl && pl !== "être" && !ETRE_INTRANSITIFS.has(pl)) {
        passiveCount++;
        break;
      }
    }
  }

  const top = (map: Map<string, number>, k: number): [string, number][] =>
    [...map.entries()].sort((x, y) => y[1] - x[1]).slice(0, k);

  const hapaxCount = [...allLemmas.values()].filter((v) => v === 1).length;
  const mentTotal = [...ment.values()].reduce((s, v) => s + v, 0);

  const verbTotal = [...verbs.values()].reduce((s, v) => s + v, 0);
  const weak = [...verbs.entries()]
    .filter(([l]) => VERBES_PASSE_PARTOUT.has(l))
    .sort((x, y) => y[1] - x[1]);
  const weakTotal = weak.reduce((s, v) => s + v[1], 0);

  const richness = contentTotal > 0 ? allLemmas.size / contentTotal : 0;

  return {
    richness,
    uniqueLemmas: allLemmas.size,
    contentTotal,
    hapaxCount,
    favoriteVerbs: top(verbs, 5),
    weakVerbs: weak.slice(0, 5),
    weakTotal,
    weakPct: verbTotal > 0 ? Math.round((weakTotal / verbTotal) * 100) : 0,
    favoriteAdjs: top(adjs, 5),
    favoriteAdvs: top(advs, 5),
    mentAdverbs: top(ment, 5),
    mentTotal,
    mentPct: contentTotal > 0 ? Math.round((mentTotal / contentTotal) * 100) : 0,
    passiveCount,
    grammaticalCategories: categories,
  };
}

/* eslint-enable @typescript-eslint/no-require-imports -- fin du bloc require paresseux */
