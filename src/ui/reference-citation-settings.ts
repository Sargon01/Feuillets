import { type App, Modal, TFile, TFolder } from "obsidian";
import { t } from "../i18n/index.js";
import { resolveReferenceContextRoot, type ReferenceCitationContext } from "../services/research-reference-search.js";
import { resolveDocumentCitationStyleSetting } from "../services/document-citation-style.js";
import type { CslCitationHost } from "../services/csl-citation-host.js";
import {
  ensureExactFolderWorkspaceConfig, folderPathToWorkspaceScope,
  getFolderWorkspaceConfig, isFolderWorkspaceConfigEmpty, workspaceScopeToFolderPath,
} from "../services/folder-workspaces.js";
import { listWorkspaceCitationCandidates, resolveWorkspaceCitationResources, type ResolvedWorkspaceCitationResource } from "../services/workspace-citations.js";

type CitationSetting = "pandocCitationPreviewStyle" | "citekeyBibliographyPath" | "citekeyCslPath";
type CitationSettingsPlugin = {
  cslCitationHost?: Pick<CslCitationHost, "getProvider"> | null;
  settings: FeuilletsSettings;
  getWorkspaceFolder?(): TFolder | null;
  saveSettings(): Promise<void>;
  refreshCitationRendering?(): void;
  renderAllViews(force?: boolean): void;
};
const FIELDS: readonly CitationSetting[] = ["pandocCitationPreviewStyle", "citekeyBibliographyPath", "citekeyCslPath"];
const INHERIT = "__inherit__";
const EFFECTIVE = "__effective__";
const openControls = new WeakMap<CitationSettingsPlugin, Set<ReferenceCitationSettingsControls>>();
const settingsWrites = new WeakMap<Pick<CitationSettingsPlugin, "saveSettings">, Promise<void>>();

/** Keep workspace settings writes ordered while edits update memory immediately. */
export function saveWorkspaceSettings(plugin: Pick<CitationSettingsPlugin, "saveSettings">): Promise<void> {
  const previous = settingsWrites.get(plugin);
  const current = previous ? previous.catch(() => {}).then(() => plugin.saveSettings()) : plugin.saveSettings();
  settingsWrites.set(plugin, current);
  const clear = (): void => { if (settingsWrites.get(plugin) === current) settingsWrites.delete(plugin); };
  void current.then(clear, clear);
  return current;
}

export function refreshReferenceCitationSettings(plugin: CitationSettingsPlugin): void {
  for (const controls of openControls.get(plugin) ?? []) controls.refresh();
}

export function renderCslCompanionNotice(
  container: HTMLElement,
  plugin: CitationSettingsPlugin,
  mode: string
): void {
  container.empty();
  if (mode !== "csl") return;

  container.createDiv({
    cls: "setting-item-description",
    text: t("project.pandocCitationPreview.cslCompanionRequired"),
  });

  if (!plugin.cslCitationHost?.getProvider()) {
    container.createDiv({
      cls: "feuillets-reference-warning",
      text: t("project.pandocCitationPreview.cslCompanionMissing"),
    });
  }
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
    if (this.context.targetScope instanceof TFile) {
      this.context = { ...this.context, scopeRoot: resolveReferenceContextRoot(this.app, this.plugin.settings,
        this.context.projectRoot, this.context.targetScope, this.plugin.getWorkspaceFolder?.() ?? null) };
    }
    this.modalEl.addClass("feuillets-reference-settings-modal");
    this.modalEl.setAttr("aria-label", t("shared.research.bibliographySettings"));
    this.controls = new ReferenceCitationSettingsControls(this.app, this.plugin, this.context, this.isCurrent, this.contentEl, () => this.close());
    this.controls.open();
  }

  onClose(): void {
    this.controls?.destroy();
  }
}

/** Shared inline controls use the current citation resolvers and exact settings writers. */
export class ReferenceCitationSettingsControls {
  active = false;
  saving = false;
  private customize = false;
  private pendingSaves = 0;
  private block: HTMLElement | null = null;
  private scopeEl: HTMLElement | null = null;
  private noticeEl: HTMLElement | null = null;
  private actionEl: HTMLButtonElement | null = null;
  private hasLocalOverrides = false;
  private readonly rows = new Map<CitationSetting, { select: HTMLSelectElement; source: HTMLElement; options: string }>();

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
    this.block = null;
    this.scopeEl = null;
    this.noticeEl = null;
    this.actionEl = null;
    this.rows.clear();
  }

  refresh(): void { if (this.active) this.renderContent(); }

  private renderContent(): void {
    const { contentEl, context: { projectRoot, scopeRoot, targetScope } } = this;
    contentEl.addClass("feuillets-reference-controls");
    if (!this.active || !this.isCurrent()) { this.closeOwner(); return; }
    if (!this.block && this.showHeading) contentEl.createEl("h3", { text: t("shared.research.bibliographySettings") });
    const workspace = scopeRoot.path !== projectRoot.path;
    const relativeScope = workspace ? folderPathToWorkspaceScope(projectRoot.path, scopeRoot.path) : null;
    if (workspace && !relativeScope) { this.closeOwner(); return; }
    const meta = this.plugin.settings.projectMeta?.[projectRoot.path];
    const local = relativeScope ? getFolderWorkspaceConfig(meta, relativeScope) : meta;
    const hasLocal = workspace && FIELDS.some((field) => local?.[field] !== undefined);
    this.hasLocalOverrides = hasLocal;
    const editable = !workspace || hasLocal || this.customize;
    this.scopeEl ??= contentEl.createDiv({ cls: "feuillets-reference-setting-scope" });
    this.scopeEl.setText(t(workspace ? "shared.research.citationWorkspaceScope" : "shared.research.citationProjectScope", { name: scopeRoot.name }));
    const resolution = resolveWorkspaceCitationResources(this.app, this.plugin.settings, projectRoot, targetScope);
    // Candidates belong to the folder receiving the override, including its Research association.
    const selection = resolveWorkspaceCitationResources(this.app, this.plugin.settings, projectRoot, scopeRoot);
    const block = this.block ??= contentEl.createDiv({ cls: "feuillets-reference-settings" });
    const mode = resolveDocumentCitationStyleSetting(this.plugin.settings, projectRoot.path, scopeRoot.path);
    const modeOwnerPath = mode.source ? workspaceScopeToFolderPath(projectRoot.path, mode.source) : null;
    const modeOwner = modeOwnerPath ? this.app.vault.getAbstractFileByPath(modeOwnerPath) : null;
    const modes: [string, string][] = [
      ["off", t("project.pandocCitationPreview.styleOff")],
      ["author-date", t("project.pandocCitationPreview.styleAuthorDate")],
      ["csl", t("project.pandocCitationPreview.styleCsl")],
    ];
    const addSelect = (field: CitationSetting, label: string, options: readonly [string, string][], effectiveValue: string, effectiveLabel: string, inherited: boolean, description: string): void => {
      let row = this.rows.get(field);
      if (!row) {
        const element = block.createEl("label", { cls: "feuillets-reference-setting" });
        element.createSpan({ cls: "feuillets-reference-setting-label", text: label });
        const control = element.createSpan({ cls: "feuillets-reference-setting-control" });
        const select = control.createEl("select", { cls: "feuillets-reference-setting-select", attr: { "aria-label": label, "data-citation-setting": field } });
        const source = control.createSpan({ cls: "setting-item-description feuillets-reference-setting-source" });
        row = { select, source, options: "" };
        this.rows.set(field, row);
        select.addEventListener("change", () => { if (!select.disabled) void this.save(field, select.value); });
      }
      const { select, source } = row;
      const choices: [string, string][] = [[INHERIT, t(workspace ? "shared.research.citationInherit" : "shared.research.citationAutomatic")], ...options];
      let selected = local?.[field];
      if (selected === undefined) {
        choices.push([EFFECTIVE, inherited ? `${effectiveLabel} (${t("modal.layout.inherited")})` : effectiveLabel]);
        selected = EFFECTIVE;
      } else if (!options.some(([value]) => value === selected)) {
        choices.push([selected, effectiveLabel]);
      }
      const signature = JSON.stringify(choices);
      if (row.options !== signature) {
        select.empty();
        for (const [value, text] of choices) {
          const option = select.createEl("option", { value, text });
          option.disabled = value === EFFECTIVE;
        }
        row.options = signature;
      }
      select.value = selected;
      select.disabled = !editable;
      select.setAttr("title", [effectiveLabel, description].filter(Boolean).join(" — "));
      select.setAttr("data-inherited", String(inherited));
      select.setAttr("data-effective-value", effectiveValue);
      source.setText(description);
      source.hidden = !description;
    };
    const modeInherited = workspace && local?.pandocCitationPreviewStyle === undefined;
    const modeDescription = modeInherited ? modeOwner instanceof TFolder && modeOwner.path !== projectRoot.path
      ? t("modal.folderWorkspace.inheritedFromParent", { name: modeOwner.name }) : t("modal.folderWorkspace.inheritedFromProject")
      : t("modal.folderWorkspace.local");
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
    this.noticeEl ??= contentEl.createDiv({ cls: "feuillets-reference-companion-notice" });
    renderCslCompanionNotice(this.noticeEl, this.plugin, mode.value || "off");
    if (workspace) {
      if (!this.actionEl) {
        const action = this.actionEl = contentEl.createEl("button", { cls: "feuillets-reference-settings-inheritance", attr: { type: "button" } });
        action.addEventListener("click", () => {
          if (!this.active || !this.isCurrent() || action.disabled) return;
          if (this.hasLocalOverrides) void this.save(null, INHERIT);
          else { this.customize = true; this.renderContent(); }
        });
      }
      const action = this.actionEl;
      action.setText(t(hasLocal ? "shared.research.citationReturnInherited" : "shared.research.citationUseSpecific"));
      action.disabled = this.saving || (!hasLocal && this.customize);
    }
  }

  private async save(field: CitationSetting | null, value: string): Promise<void> {
    const { projectRoot, scopeRoot } = this.context;
    if (!this.active || !this.isCurrent() || this.app.vault.getAbstractFileByPath(scopeRoot.path) !== scopeRoot || value === EFFECTIVE) return;
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
    this.pendingSaves++;
    this.saving = true;
    this.renderContent();
    refreshReferenceCitationSettings(this.plugin);
    this.plugin.refreshCitationRendering?.();
    try {
      await saveWorkspaceSettings(this.plugin);
      this.plugin.renderAllViews(true);
      this.onSaved?.();
    } finally {
      this.saving = --this.pendingSaves > 0;
      refreshReferenceCitationSettings(this.plugin);
    }
  }
}

export function renderReferenceCitationWarnings(container: HTMLElement, app: App, settings: FeuilletsSettings, context: ReferenceCitationContext): void {
  const mode = resolveDocumentCitationStyleSetting(settings, context.projectRoot.path, (context.targetScope instanceof TFile ? context.targetScope.parent ?? context.scopeRoot : context.targetScope).path).value;
  if (!mode || mode === "off") return;
  const resources = resolveWorkspaceCitationResources(app, settings, context.projectRoot, context.targetScope);
  const warnings = [
    ...(resources.bibliography.status !== "valid" ? [t("shared.research.citationBibliographyMissing")] : []),
    ...(mode === "csl" && resources.csl.status !== "valid" ? [t("shared.research.citationStyleMissing")] : []),
  ];
  for (const warning of warnings) container.createDiv({ cls: "feuillets-reference-warning", text: warning });
}
