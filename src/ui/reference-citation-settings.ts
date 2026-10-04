import { type App, Modal, TFolder } from "obsidian";
import { t } from "../i18n/index.js";
import type { ReferenceCitationContext } from "../services/research-reference-search.js";
import { resolveDocumentCitationStyleSetting } from "../services/document-citation-style.js";
import {
  ensureExactFolderWorkspaceConfig, folderPathToWorkspaceScope,
  getFolderWorkspaceConfig, isFolderWorkspaceConfigEmpty, workspaceScopeToFolderPath,
} from "../services/folder-workspaces.js";
import { listWorkspaceCitationCandidates, resolveWorkspaceCitationResources, type ResolvedWorkspaceCitationResource } from "../services/workspace-citations.js";

type CitationSetting = "pandocCitationPreviewStyle" | "citekeyBibliographyPath" | "citekeyCslPath";
type CitationSettingsPlugin = {
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
  refreshCitationRendering?(): void;
  renderAllViews(force?: boolean): void;
};
const FIELDS: readonly CitationSetting[] = ["pandocCitationPreviewStyle", "citekeyBibliographyPath", "citekeyCslPath"];
const INHERIT = "__inherit__";
const EFFECTIVE = "__effective__";
const openControls = new WeakMap<CitationSettingsPlugin, Set<ReferenceCitationSettingsControls>>();

export function refreshReferenceCitationSettings(plugin: CitationSettingsPlugin): void {
  for (const controls of openControls.get(plugin) ?? []) controls.refresh();
}

function resourceDescription(resource: ResolvedWorkspaceCitationResource, projectRoot: TFolder, local: boolean): string {
  if (resource.status === "not_configured") return t("modal.folderWorkspace.notConfigured");
  const provenance = local ? t("modal.folderWorkspace.local")
    : resource.source === "legacy" ? t("modal.folderWorkspace.inheritedFromLegacy")
    : resource.sourceScope && resource.sourceScope.path !== projectRoot.path
      ? t("modal.folderWorkspace.inheritedFromParent", { name: resource.sourceScope.name })
      : t("modal.folderWorkspace.inheritedFromProject");
  const status = resource.status;
  const detail = status === "disabled" ? t("modal.folderWorkspace.disabled")
    : status === "missing_file" ? t("modal.folderWorkspace.missingFile")
    : status === "invalid_path" ? t("modal.folderWorkspace.invalidPath")
    : status === "unbound_research" ? t("modal.folderWorkspace.unboundResearch") : "";
  return [provenance, detail].filter(Boolean).join(" — ");
}

export class ReferenceCitationSettingsModal extends Modal {
  private controls: ReferenceCitationSettingsControls | null = null;

  get active(): boolean { return this.controls?.active ?? false; }
  get saving(): boolean { return this.controls?.saving ?? false; }

  constructor(app: App, private plugin: CitationSettingsPlugin, private context: ReferenceCitationContext, private isCurrent: () => boolean) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("feuillets-reference-settings-modal");
    this.modalEl.setAttr("aria-label", t("shared.research.bibliographySettings"));
    this.controls = new ReferenceCitationSettingsControls(this.app, this.plugin, this.context, this.isCurrent, this.contentEl, () => this.close());
    this.controls.open();
  }

  onClose(): void {
    this.controls?.destroy();
  }
}

/** Shared inline controls use the existing citation resolvers and exact settings writers. */
export class ReferenceCitationSettingsControls {
  active = false;
  saving = false;
  private customize = false;

  constructor(private app: App, private plugin: CitationSettingsPlugin, private context: ReferenceCitationContext,
    private isCurrent: () => boolean, private contentEl: HTMLElement, private closeOwner: () => void = () => this.destroy(),
    private showHeading = true, private onSaved?: () => void) {}

  open(): void {
    this.active = true;
    let controls = openControls.get(this.plugin);
    if (!controls) { controls = new Set(); openControls.set(this.plugin, controls); }
    controls.add(this);
    this.renderContent();
  }

  destroy(): void {
    this.active = false;
    openControls.get(this.plugin)?.delete(this);
    this.contentEl.empty();
  }

  refresh(): void { if (this.active) this.renderContent(); }

  private renderContent(): void {
    const { contentEl, context: { projectRoot, scopeRoot, targetScope } } = this;
    contentEl.empty();
    if (!this.active || !this.isCurrent()) { this.closeOwner(); return; }
    if (this.showHeading) contentEl.createEl("h3", { text: t("shared.research.bibliographySettings") });
    const workspace = scopeRoot.path !== projectRoot.path;
    const relativeScope = workspace ? folderPathToWorkspaceScope(projectRoot.path, scopeRoot.path) : null;
    if (workspace && !relativeScope) { this.closeOwner(); return; }
    const meta = this.plugin.settings.projectMeta?.[projectRoot.path];
    const local = relativeScope ? getFolderWorkspaceConfig(meta, relativeScope) : meta;
    const hasLocal = workspace && FIELDS.some((field) => local?.[field] !== undefined);
    const editable = !workspace || hasLocal || this.customize;
    contentEl.createDiv({ cls: "feuillets-reference-setting-scope", text: t(workspace ? "shared.research.citationWorkspaceScope" : "shared.research.citationProjectScope", { name: scopeRoot.name }) });
    const resolution = resolveWorkspaceCitationResources(this.app, this.plugin.settings, projectRoot, targetScope);
    // Candidates belong to the folder receiving the override, including its Research association.
    const selection = resolveWorkspaceCitationResources(this.app, this.plugin.settings, projectRoot, scopeRoot);
    const block = contentEl.createDiv({ cls: "feuillets-reference-settings" });
    const mode = resolveDocumentCitationStyleSetting(this.plugin.settings, projectRoot.path, scopeRoot.path);
    const modeOwnerPath = mode.source ? workspaceScopeToFolderPath(projectRoot.path, mode.source) : null;
    const modeOwner = modeOwnerPath ? this.app.vault.getAbstractFileByPath(modeOwnerPath) : null;
    const modes: [string, string][] = [
      ["off", t("project.pandocCitationPreview.styleOff")],
      ["author-date", t("project.pandocCitationPreview.styleAuthorDate")],
      ["csl", t("project.pandocCitationPreview.styleCsl")],
    ];
    const addSelect = (field: CitationSetting, label: string, options: readonly [string, string][], effectiveValue: string, effectiveLabel: string, inherited: boolean, description: string): void => {
      const row = block.createEl("label", { cls: "feuillets-reference-setting" });
      row.createSpan({ cls: "feuillets-reference-setting-label", text: label });
      const select = row.createEl("select", { cls: "feuillets-reference-setting-select", attr: { "aria-label": label, "data-citation-setting": field } });
      select.createEl("option", { value: INHERIT, text: t(workspace ? "shared.research.citationInherit" : "shared.research.citationAutomatic") });
      for (const [value, text] of options) select.createEl("option", { value, text });
      let selected = local?.[field];
      if (selected === undefined) {
        const summary = select.createEl("option", { value: EFFECTIVE, text: inherited ? `${effectiveLabel} (${t("modal.layout.inherited")})` : effectiveLabel });
        summary.disabled = true;
        selected = EFFECTIVE;
      } else if (!options.some(([value]) => value === selected)) {
        select.createEl("option", { value: selected, text: effectiveLabel });
      }
      select.value = selected;
      select.disabled = !editable || this.saving;
      select.setAttr("title", [effectiveLabel, description].filter(Boolean).join(" — "));
      select.setAttr("data-inherited", String(inherited));
      select.setAttr("data-effective-value", effectiveValue);
      if (description) row.createSpan({ cls: "setting-item-description feuillets-reference-setting-source", text: description });
      select.addEventListener("change", () => { if (!select.disabled) void this.save(field, select.value); });
    };
    const modeInherited = workspace && local?.pandocCitationPreviewStyle === undefined;
    const modeDescription = modeInherited ? modeOwner instanceof TFolder && modeOwner.path !== projectRoot.path
      ? t("modal.folderWorkspace.inheritedFromParent", { name: modeOwner.name }) : t("modal.folderWorkspace.inheritedFromProject") : "";
    addSelect("pandocCitationPreviewStyle", t("shared.research.citationRendering"), modes, mode.value || "off", modes.find(([value]) => value === mode.value)?.[1] || modes[0][1], modeInherited, modeDescription);
    for (const [field, extension, resource, label] of [
      ["citekeyBibliographyPath", "bib", resolution.bibliography, t("shared.research.citationBibliography")],
      ["citekeyCslPath", "csl", resolution.csl, t("shared.research.citationCslStyle")],
    ] as const) {
      const options: [string, string][] = [["", t("project.pandocCitationPreview.noFile")],
        ...listWorkspaceCitationCandidates(this.app, selection.selectionResearchFolder, extension).map((candidate): [string, string] => [candidate.relativePath, candidate.relativePath])];
      const effective = resource.relativePath ?? resource.configuredPath ?? "";
      let effectiveLabel = effective || t("project.pandocCitationPreview.noFile");
      if (effective && resource.status !== "valid") effectiveLabel += ` (${t("project.pandocCitationPreview.missingFile")})`;
      const inherited = workspace && local?.[field] === undefined;
      addSelect(field, label, options, effective, effectiveLabel, inherited, resourceDescription(resource, projectRoot, !workspace || local?.[field] !== undefined));
    }
    if (workspace) {
      const action = contentEl.createEl("button", { cls: "feuillets-reference-settings-inheritance", text: t(hasLocal ? "shared.research.citationReturnInherited" : "shared.research.citationUseSpecific"), attr: { type: "button" } });
      action.disabled = this.saving || (!hasLocal && this.customize);
      action.addEventListener("click", () => {
        if (!this.active || !this.isCurrent() || action.disabled) return;
        if (hasLocal) void this.save(null, INHERIT);
        else { this.customize = true; this.renderContent(); }
      });
    }
  }

  private async save(field: CitationSetting | null, value: string): Promise<void> {
    const { projectRoot, scopeRoot } = this.context;
    if (!this.active || !this.isCurrent() || this.saving || this.app.vault.getAbstractFileByPath(scopeRoot.path) !== scopeRoot || value === EFFECTIVE) return;
    const relativeScope = scopeRoot.path !== projectRoot.path ? folderPathToWorkspaceScope(projectRoot.path, scopeRoot.path) : null;
    if (field === null && !relativeScope) return;
    if (field === "pandocCitationPreviewStyle" && value !== INHERIT && value !== "off" && value !== "author-date" && value !== "csl") return;
    if (field && field !== "pandocCitationPreviewStyle" && value !== INHERIT && value !== "") {
      const current = resolveWorkspaceCitationResources(this.app, this.plugin.settings, projectRoot, scopeRoot);
      const extension = field === "citekeyBibliographyPath" ? "bib" : "csl";
      if (!listWorkspaceCitationCandidates(this.app, current.selectionResearchFolder, extension).some((candidate) => candidate.relativePath === value)) return;
    }
    const project = this.plugin.settings.projectMeta[projectRoot.path] ||= {};
    const workspaceConfig = relativeScope ? value === INHERIT ? getFolderWorkspaceConfig(project, relativeScope) : ensureExactFolderWorkspaceConfig(this.app, this.plugin.settings, scopeRoot) : null;
    const config = relativeScope ? workspaceConfig : project;
    if (!config) return;
    if (value === INHERIT) {
      for (const key of field ? [field] : FIELDS) delete config[key];
      if (relativeScope && workspaceConfig && isFolderWorkspaceConfigEmpty(workspaceConfig)) {
        delete project.folderWorkspaces?.[relativeScope];
        if (!Object.keys(project.folderWorkspaces || {}).length) delete project.folderWorkspaces;
      }
      if (field === null) this.customize = false;
    } else if (field === "pandocCitationPreviewStyle") {
      if (value === "off" || value === "author-date" || value === "csl") config[field] = value;
    } else if (field) {
      config[field] = value;
      if (!relativeScope && field === "citekeyBibliographyPath") delete project.pandocBibliographyPath;
    }
    this.saving = true;
    this.renderContent();
    refreshReferenceCitationSettings(this.plugin);
    this.plugin.refreshCitationRendering?.();
    try {
      await this.plugin.saveSettings();
      this.plugin.renderAllViews(true);
      this.onSaved?.();
    } finally {
      this.saving = false;
      refreshReferenceCitationSettings(this.plugin);
    }
  }
}

export function renderReferenceCitationWarnings(container: HTMLElement, app: App, settings: FeuilletsSettings, context: ReferenceCitationContext): void {
  const mode = resolveDocumentCitationStyleSetting(settings, context.projectRoot.path, context.scopeRoot.path).value;
  if (!mode || mode === "off") return;
  const resources = resolveWorkspaceCitationResources(app, settings, context.projectRoot, context.targetScope);
  const warnings = [
    ...(resources.bibliography.status !== "valid" ? [t("shared.research.citationBibliographyMissing")] : []),
    ...(mode === "csl" && resources.csl.status !== "valid" ? [t("shared.research.citationStyleMissing")] : []),
  ];
  for (const warning of warnings) container.createDiv({ cls: "feuillets-reference-warning", text: warning });
}
