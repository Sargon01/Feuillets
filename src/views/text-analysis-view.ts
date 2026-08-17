import { TFile, setIcon, Notice, MarkdownView, type Editor, type WorkspaceLeaf } from "obsidian";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import type { ResolvedAnalysisIssue, TextAnalysisProvider } from "../api/text-analysis.js";
import type { AnalysisRun } from "../services/text-analysis.js";
import { openIssueContextMenu } from "../services/grammar-context-menu.js";
import { renderCollapsibleHead, selectRange } from "../utils/dom.js";
import { t } from "../i18n/index.js";

type BaseFeuilletsPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1];
type TextAnalysisViewPlugin = BaseFeuilletsPlugin & {
  analysisRun?: AnalysisRun | null;
  analysisRunning?: boolean;
  getAnalysisProvider(providerId?: string): TextAnalysisProvider | null;
  analyzeActiveFile(): Promise<void>;
  activeEditorAnywhere(): Editor | null;
};

const SEVERITY_ICON: Record<string, string> = {
  error: "circle-alert",
  warning: "triangle-alert",
  info: "info",
};

/** Panneau « Relecture » : affiche les signalements rendus par un module
 * compagnon d'analyse linguistique (voir src/api/text-analysis.ts). Feuillets
 * n'analyse rien lui-même — sans compagnon installé, ce panneau le dit et
 * s'arrête là. Aucun faux résultat, aucune erreur.
 *
 * Sous-vue de SidebarFeuilletsView (onglet), comme Notes ou Analyse : elle
 * n'est jamais ouverte comme sa propre feuille, donc pas de onOpen() ici —
 * SidebarFeuilletsView appelle directement render(). */
export class TextAnalysisView extends BaseFeuilletsView {
  declare plugin: TextAnalysisViewPlugin;
  declare targetContainer?: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: BaseFeuilletsPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return "feuillets-text-analysis";
  }

  getDisplayText(): string {
    return t("analysisResults.displayText");
  }

  getIcon(): string {
    return "spell-check";
  }

  async render(): Promise<void> {
    const container = this.targetContainer || this.contentEl;
    const prevScrollTop = container.scrollTop;

    container.empty();
    container.addClass("feuillets-grammar-container");

    const provider = this.plugin.getAnalysisProvider();
    if (!provider) {
      // Sans compagnon d'analyse installé, le correcteur est indisponible :
      // l'état vide existant, rien d'autre. Aucune vérification native, aucun
      // faux résultat (les répétitions rapprochées vivent dans Statistiques).
      container.createDiv({ cls: "feuillets-research-empty" }).setText(t("analysisResults.noFindings"));
      return;
    }

    const toolbar = container.createDiv({ cls: "feuillets-research-toolbar" });
    this.iconBtn(toolbar, "refresh-cw", t("analysisResults.rerunTooltip"), () =>
      this.plugin.analyzeActiveFile()
    );

    const { section: summary } = renderCollapsibleHead(container, {
      classes: { section: "feuillets-notes-section", head: "feuillets-notes-section-head", icon: "feuillets-notes-section-icon", title: "feuillets-notes-section-title" },
      title: t("analysisResults.corrector"), icon: "spell-check", collapsed: false, collapseKey: "relecture:linguistic",
      settings: { collapsed: {} }, onToggle: () => {},
    });
    const sub = summary.createDiv({ cls: "feuillets-notes-sub" });
    const badge = summary.createSpan({ cls: "feuillets-tag-chip feuillets-mt-xs" });
    badge.setText(provider.name);

    if (this.plugin.analysisRunning) {
      sub.setText(t("analysisResults.running"));
      return;
    }

    const run = this.plugin.analysisRun;
    if (!run) {
      sub.setText(t("analysisResults.notRunYet"));
      return;
    }
    const activeFile = this.app.workspace.getActiveFile?.();
    if (activeFile && (!(activeFile instanceof TFile) || run.filePath !== activeFile.path)) {
      sub.setText(t("analysisResults.notRunYet"));
      return;
    }

    sub.setText(
      t(run.scope === "selection" ? "analysisResults.summarySelection" : "analysisResults.summaryDocument", {
        count: String(run.issues.length),
        title: run.fileTitle,
      })
    );

    const file = this.app.vault.getAbstractFileByPath(run.filePath);
    if (file instanceof TFile && file.stat.mtime !== run.mtime) {
      summary.createDiv({ cls: "feuillets-notes-sub" }).setText(t("analysisResults.stale"));
    }

    if (run.issues.length === 0) {
      container.createDiv({ cls: "feuillets-research-empty" }).setText(t("analysisResults.noIssues"));
      return;
    }

    const list = container.createDiv({ cls: "feuillets-research-list" });
    for (const issue of run.issues) this.renderIssue(list, issue);

    container.scrollTop = prevScrollTop;
  }

  renderIssue(container: HTMLElement, issue: ResolvedAnalysisIssue): void {
    const row = container.createDiv({ cls: "feuillets-research-item feuillets-grammar-row feuillets-clickable" });
    const header = row.createDiv({ cls: "feuillets-research-item-header" });
    const icon = header.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(icon, SEVERITY_ICON[issue.severity ?? "warning"] ?? "info");

    const name = header.createDiv({ cls: "feuillets-research-item-name" });
    const meta = [issue.category, issue.ruleId].filter((v): v is string => Boolean(v)).join(" · ");
    if (meta) name.createDiv({ cls: "feuillets-docx-review-meta" }).setText(meta);
    name.createDiv({ cls: "feuillets-grammar-message" }).setText(issue.message);

    const excerpt = this.excerptFor(issue);
    if (excerpt) name.createDiv({ cls: "feuillets-docx-review-anchor" }).setText(`« ${excerpt} »`);

    // Afficher le chemin de fichier uniquement pour une analyse multi-fichiers / roman
    const run = this.plugin.analysisRun;
    const isMultiFile = run && run.scope !== "document" && run.scope !== "selection";
    if (isMultiFile || (run && issue.filePath !== run.filePath)) {
      const shortPath = issue.filePath.split("/").slice(-2).join("/");
      name.createDiv({ cls: "feuillets-docx-review-meta feuillets-mt-xs" }).setText(shortPath);
    }

    row.title = t("analysisResults.jumpTooltip");
    row.addEventListener("click", () => {
      void this.revealIssue(issue);
    });

    row.addEventListener("contextmenu", (evt) => {
      openIssueContextMenu(this.plugin, issue, evt, issue.filePath);
    });
  }

  /* L'extrait vient du dernier texte analysé, conservé pour ça — le
     fournisseur n'a pas à renvoyer le passage concerné en plus des offsets. */
  excerptFor(issue: ResolvedAnalysisIssue): string {
    const run = this.plugin.analysisRun;
    if (!run || run.filePath !== issue.filePath) return "";
    const excerpt = run.sourceText.slice(issue.start, issue.end).trim();
    return excerpt.length > 80 ? `${excerpt.slice(0, 80)}…` : excerpt;
  }

  /** Ouvre le fichier concerné et sélectionne la plage. Une seule
   *  implémentation de la navigation vers un signalement, partagée par le
   *  panneau et les commandes — le compagnon n'en refait pas une autre. */
  async revealIssue(issue: ResolvedAnalysisIssue): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(issue.filePath);
    if (!(file instanceof TFile)) {
      new Notice(t("analysisResults.fileGone", { path: issue.filePath }));
      return;
    }

    /* openFile() est attendu, contrairement à openFileActivating() : sans
       cela leaf.view est encore la vue précédente et la sélection irait dans
       le mauvais document (même schéma que DocxReviewView.openAndReveal). */
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });

    const editor = leaf.view instanceof MarkdownView ? leaf.view.editor : this.plugin.activeEditorAnywhere();
    if (!editor) return;
    selectRange(editor, issue.start, issue.end);
  }
}
