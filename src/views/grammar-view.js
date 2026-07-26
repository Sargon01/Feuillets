const { TFile, Platform, setIcon, Notice, Menu } = require("obsidian");
import { VIEW_GRAMMAR } from "../constants.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { applyGrammarHighlights, clearGrammarHighlights } from "../utils/cm-grammar-highlighter.js";
import { grammarIssueSignature } from "../utils/grammar-issue-signature.js";
import { sanitizeForGrammarCheck } from "../utils/sanitize-for-grammar.js";
import { t, getLocale } from "../i18n/index.js";

const TYPE_ICON = { grammar: "spell-check", spelling: "text-cursor-input" };
function typeLabel(type) {
  return type === "spelling" ? t("grammar.type.spelling") : t("grammar.type.grammar");
}

/** Onglet Grammalecte : vérifie le feuillet actif (pas tout le projet — un
 * choix délibéré, voir la discussion produit : plus réactif, se comporte
 * comme un panneau "Problèmes" qui suit l'édition en cours plutôt qu'une
 * analyse de fond sur tout le manuscrit). Desktop uniquement : le moteur
 * local (Grammalecte/Harper, vm/fs, voir GrammarCheckerManager) est
 * indisponible sur Obsidian mobile. */
export class GrammarView extends BaseFeuilletsView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
    this.issues = [];
    this.checking = false;
    this.checkedPath = null;
    this.checkedMtime = null;
    this.frontmatterOffset = 0; // longueur du frontmatter retiré avant vérification, à rajouter aux offsets
    this._highlightedEditor = null; // dernier EditorView CM6 souligné, pour l'effacer si le feuillet change
    // Pointeur vers l'instance courante, pour que grammarClickHandler (clic sur
    // un mot souligné dans l'éditeur) retrouve la bonne ligne — voir
    // cm-grammar-highlighter.js. Écrasé sans souci si plusieurs instances se
    // succèdent (fermeture/réouverture du panneau) : seule la plus récente compte.
    this.plugin._grammarView = this;
  }

  getViewType() {
    return VIEW_GRAMMAR;
  }
  getDisplayText() {
    return t("grammar.displayText");
  }
  getIcon() {
    return "spell-check";
  }

  /* Pas de onOpen() avec registerEvent ici : ce sous-panneau n'est jamais
     ouvert comme sa propre feuille (voir SidebarFeuilletsView, qui appelle
     directement .render() sur cette instance) — onOpen() n'y est donc
     jamais invoqué par Obsidian, ce serait du code mort. La détection de
     fichier/contenu changé se fait directement dans render(), déjà rappelé
     par le rafraîchissement global du plugin (vault "modify" ->
     refreshView() -> renderAllViews(), main.js) quand cet onglet est actif. */
  /* isTabVisible : le rendu (this.render()) écrit dans this.targetContainer/
     contentEl, partagé avec SidebarFeuilletsView — sans garde, appeler
     render() alors qu'un AUTRE onglet est affiché écraserait son contenu.
     runCheck() doit donc pouvoir tourner "en tête" (déclenché par une
     commande, sans jamais ouvrir cet onglet — voir main.js) sans jamais
     toucher au rendu tant que ce n'est pas l'onglet actif. */
  isTabVisible() {
    const sidebarView = this.leaf && this.leaf.view;
    return !!(sidebarView && sidebarView.activeTab === "grammar");
  }

  async runCheck(file) {
    this.checking = true;
    this.checkedPath = file.path;
    this.checkedMtime = file.stat.mtime;
    if (this._highlightedEditor) clearGrammarHighlights(this._highlightedEditor);
    if (this.isTabVisible()) await this.render();
    try {
      const raw = await this.app.vault.cachedRead(file);
      const { body } = this.splitFrontmatter(raw);
      this.frontmatterOffset = raw.length - body.length; // le YAML n'est jamais soumis au correcteur
      // sanitizeForGrammarCheck préserve la longueur du texte (masque au lieu
      // de supprimer) : les offsets restent valables tels quels, aucun
      // remappage supplémentaire nécessaire au-delà de frontmatterOffset.
      const sanitized = sanitizeForGrammarCheck(body);
      // this.plugin.settings.locale n'existe pas : la langue d'interface
      // effective (réglage settings.language + repli sur Obsidian lui-même)
      // vit dans le module i18n, voir detectLocale()/setLocale() dans main.js.
      const activeLocale = getLocale();
      this.issues = this.plugin.grammarCheckerManager
        ? await this.plugin.grammarCheckerManager.checkText(sanitized, this.plugin.settings, activeLocale)
        : [];
      this.highlightInEditor();
    } catch (e) {
      new Notice(t("grammar.checkUnavailable", { error: e.message }));
      this.issues = [];
    } finally {
      this.checking = false;
      if (this.isTabVisible()) await this.render();
    }
  }

  highlightInEditor() {
    const editor = this.plugin.activeEditorAnywhere();
    const cm = editor && editor.cm;
    if (!cm) return;
    applyGrammarHighlights(cm, this.issues, this.frontmatterOffset);
    this._highlightedEditor = cm;
  }

  /* Clic sur un mot souligné dans l'éditeur (voir cm-grammar-highlighter.js,
     grammarClickHandler) : bascule/révèle cet onglet si besoin, puis fait
     défiler jusqu'à la ligne correspondante avec un bref flash visuel. */
  async highlightRowInPanel(idx) {
    const sidebarView = this.leaf && this.leaf.view;
    if (sidebarView && sidebarView.activeTab !== "grammar" && typeof sidebarView.render === "function") {
      sidebarView.activeTab = "grammar";
      this.plugin.settings.activeRightPanelTab = "grammar";
      await this.plugin.saveSettings();
      await sidebarView.render();
    }
    this.app.workspace.revealLeaf(this.leaf);

    const container = this.targetContainer || this.contentEl;
    const row = container.querySelectorAll(".feuillets-grammar-row")[idx];
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.addClass("feuillets-grammar-row-flash");
    setTimeout(() => row.removeClass("feuillets-grammar-row-flash"), 1200);
  }

  /* Clic sur un mot souligné dans l'éditeur (voir cm-grammar-highlighter.js,
     grammarClickHandler) : menu flottant à la position du clic, façon
     Ulysses — corriger/ignorer/apprendre sans quitter l'éditeur ni ouvrir
     l'onglet. Réutilise exactement les mêmes actions que les lignes du
     panneau (applySuggestion/ignoreIssue/learnWord), donc les deux surfaces
     restent cohérentes. */
  showIssueMenu(idx, event) {
    const issue = this.issues[idx];
    if (!issue) return;
    const file = this.app.vault.getAbstractFileByPath(this.checkedPath);
    if (!(file instanceof TFile)) return;

    const menu = new Menu();
    menu.addItem((item) => item.setTitle(issue.message).setDisabled(true));

    if (issue.suggestions && issue.suggestions.length > 0) {
      menu.addSeparator();
      for (const sugg of issue.suggestions.slice(0, 8)) {
        menu.addItem((item) =>
          item
            .setTitle(sugg)
            .setIcon("check")
            .onClick(() => this.applySuggestion(file, issue, sugg))
        );
      }
    }

    menu.addSeparator();
    if (issue.type === "spelling") {
      menu.addItem((item) =>
        item
          .setTitle(t("grammar.learn"))
          .setIcon("book-plus")
          .onClick(() => this.learnWord(issue.underlined))
      );
    } else {
      menu.addItem((item) =>
        item
          .setTitle(t("grammar.ignore"))
          .setIcon("eye-off")
          .onClick(() => this.ignoreIssue(issue))
      );
    }
    menu.addItem((item) =>
      item
        .setTitle(t("grammar.viewInPanel"))
        .setIcon("panel-right")
        .onClick(() => this.highlightRowInPanel(idx))
    );

    menu.showAtMouseEvent(event);
  }

  async render() {
    const container = this.targetContainer || this.contentEl;
    container.empty();
    container.addClass("feuillets-grammar-container");

    if (Platform.isMobile) {
      container
        .createDiv({ cls: "feuillets-research-empty" })
        .setText(t("grammar.unavailableOnMobile"));
      return;
    }

    const toolbar = container.createDiv({ cls: "feuillets-research-toolbar" });
    const refreshBtn = this.iconBtn(toolbar, "refresh-cw", t("grammar.recheckNowTooltip"));
    refreshBtn.addEventListener("click", () => {
      this.checkedMtime = null; // force une nouvelle vérification même si rien n'a changé
      this.render();
    });

    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      if (this._highlightedEditor) {
        clearGrammarHighlights(this._highlightedEditor);
        this._highlightedEditor = null;
      }
      container
        .createDiv({ cls: "feuillets-research-empty" })
        .setText(t("grammar.openSheetToCheck"));
      return;
    }

    const summary = container.createDiv({ cls: "feuillets-research-section" });
    const engineKey = this.plugin.settings.grammarEngine || "grammalecte";
    const engineLabel = engineKey === "languagetool" ? "LanguageTool" : (engineKey === "off" ? "Désactivé" : (engineKey === "auto" ? "LanguageTool (Auto)" : "Grammalecte"));
    const sub = summary.createDiv({ cls: "feuillets-notes-sub" });
    sub.setText(
      this.checking
        ? t("grammar.checkingInProgress", { title: this.plugin.titleFor(file) })
        : t("grammar.issuesFound", { count: this.issues.length, s: this.issues.length > 1 ? "s" : "", title: this.plugin.titleFor(file) })
    );
    const badge = summary.createSpan({ cls: "feuillets-tag-chip" });
    badge.setText(engineLabel);
    badge.style.marginTop = "4px";

    if (
      !this.checking &&
      (this.checkedPath !== file.path || this.checkedMtime !== file.stat.mtime)
    ) {
      this.runCheck(file); // ré-entrant : la fin de runCheck() rappellera render()
      return;
    }

    if (this.checking) return;

    if (this.issues.length === 0) {
      container
        .createDiv({ cls: "feuillets-research-empty" })
        .setText(t("grammar.noIssuesDetected"));
      return;
    }

    const list = container.createDiv({ cls: "feuillets-research-list" });
    for (const issue of this.issues) this.renderIssue(list, file, issue);
  }

  renderIssue(container, file, issue) {
    const row = container.createDiv({ cls: "feuillets-research-item feuillets-grammar-row" });
    const header = row.createDiv({ cls: "feuillets-research-item-header" });
    const icon = header.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(icon, TYPE_ICON[issue.type] || "info");

    const name = header.createDiv({ cls: "feuillets-research-item-name" });
    name.createDiv({ cls: "feuillets-docx-review-meta" }).setText(typeLabel(issue.type));
    name.createDiv({ cls: "feuillets-grammar-message" }).setText(issue.message);
    if (issue.underlined) {
      name.createDiv({ cls: "feuillets-docx-review-anchor" }).setText(`« ${issue.underlined} »`);
    }

    row.style.cursor = "pointer";
    row.title = t("grammar.jumpToPassageTooltip");
    row.addEventListener("click", () => this.jumpTo(file, issue));

    if (issue.type === "spelling" && issue.underlined) {
      const learnBtn = this.iconBtn(header, "book-plus", t("grammar.learnWordTooltip", { word: issue.underlined }));
      learnBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.learnWord(issue.underlined);
      });
    } else if (issue.type === "grammar") {
      const ignoreBtn = this.iconBtn(header, "eye-off", t("grammar.ignoreIssueTooltip"));
      ignoreBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.ignoreIssue(issue);
      });
    }
  }

  /* Commandes "faute suivante/précédente" (main.js) : navigue dans l'éditeur
     actif sans passer par le panneau — pour corriger scène par scène sans
     interrompre le flux d'édition. Suppose que le feuillet actif est déjà
     celui vérifié par cet onglet (this.checkedPath) ; sinon, invite à
     d'abord ouvrir l'onglet pour lancer la vérification. */
  jumpToAdjacentIssue(direction) {
    const editor = this.plugin.activeEditorAnywhere();
    const file = this.app.workspace.getActiveFile();
    if (!editor || !file) {
      new Notice(t("grammar.openSheetInEditor"));
      return;
    }
    if (this.checkedPath !== file.path) {
      new Notice(t("grammar.openTabFirst"));
      return;
    }
    if (!this.issues || this.issues.length === 0) {
      new Notice(t("grammar.noIssuesInSheet"));
      return;
    }

    const cursorOffset = editor.posToOffset(editor.getCursor()) - this.frontmatterOffset;
    let target;
    if (direction > 0) {
      target = this.issues.find((i) => i.start > cursorOffset);
      if (!target) {
        target = this.issues[0];
        new Notice(t("grammar.backToStart"));
      }
    } else {
      target = [...this.issues].reverse().find((i) => i.start < cursorOffset);
      if (!target) {
        target = this.issues[this.issues.length - 1];
        new Notice(t("grammar.backToEnd"));
      }
    }

    const from = editor.offsetToPos(target.start + this.frontmatterOffset);
    const to = editor.offsetToPos(target.end + this.frontmatterOffset);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
  }

  jumpTo(file, issue) {
    const editor = this.plugin.activeEditorAnywhere();
    if (!editor) {
      new Notice(t("grammar.openThisSheetInEditor"));
      return;
    }
    const from = editor.offsetToPos(issue.start + this.frontmatterOffset);
    const to = editor.offsetToPos(issue.end + this.frontmatterOffset);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
    if (typeof editor.focus === "function") editor.focus();
  }

  async learnWord(word) {
    if (!this.plugin.grammarUserData) return;
    if (!this.plugin.grammarUserData.learnWord(word)) return;
    new Notice(t("grammar.wordWontBeFlagged", { word }));
    this.checkedMtime = null; // force une nouvelle vérification au prochain render()
    await this.render();
  }

  async ignoreIssue(issue) {
    if (!this.plugin.grammarUserData) return;
    const sig = grammarIssueSignature(issue);
    if (!this.plugin.grammarUserData.ignoreIssueSignature(sig)) return;
    new Notice(t("grammar.issueWontBeFlagged"));
    this.checkedMtime = null; // force une nouvelle vérification au prochain render()
    await this.render();
  }

  async applySuggestion(file, issue, suggestion) {
    const start = issue.start + this.frontmatterOffset;
    const end = issue.end + this.frontmatterOffset;
    const editor = this.plugin.activeEditorAnywhere();
    if (editor) {
      editor.replaceRange(suggestion, editor.offsetToPos(start), editor.offsetToPos(end));
    } else {
      const content = await this.app.vault.read(file);
      const newContent = content.slice(0, start) + suggestion + content.slice(end);
      await this.app.vault.modify(file, newContent);
    }
    this.checkedMtime = null; // force une nouvelle vérification au prochain render()
    await this.render();
  }
}
