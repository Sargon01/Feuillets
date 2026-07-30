import { Modal, Notice, setIcon, type App } from "obsidian";
import type { GrammarUserData } from "../services/grammar-user-data.js";
import { t } from "../i18n/index.js";

type GrammarDataKind = "known" | "ignored";

type GrammarUserDataPlugin = {
  /* Absent sur mobile (require("fs")/require("vm") indisponibles — voir
     GrammalecteChecker) : reflète le vrai champ optionnel de FeuilletsPlugin. */
  grammarUserData?: GrammarUserData;
};

/** Gestion des mots appris / fautes ignorées de la correction grammaticale
 * (voir services/grammar-user-data.js) : liste filtrable par recherche,
 * suppression par entrée, vidage complet. Sortie des réglages pour que la
 * page reste compacte quel que soit le nombre d'entrées accumulées. */
export class GrammarUserDataModal extends Modal {
  plugin: GrammarUserDataPlugin;
  kind: GrammarDataKind;
  search: string;

  constructor(app: App, plugin: GrammarUserDataPlugin, kind: GrammarDataKind) {
    super(app);
    this.plugin = plugin;
    this.kind = kind; // "known" | "ignored"
    this.search = "";
  }

  onOpen() {
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  get entries(): string[] {
    const data = this.plugin.grammarUserData;
    if (!data) return [];
    return this.kind === "known" ? data.knownWords : data.ignoredRules;
  }

  labelFor(entry: string): string {
    if (this.kind === "known") return entry;
    const [ruleId, word] = entry.split("::");
    return word ? `${word} (${ruleId})` : ruleId;
  }

  remove(entry: string): void {
    const data = this.plugin.grammarUserData!;
    if (this.kind === "known") data.unlearnWord(entry);
    else data.unignoreSignature(entry);
  }

  clearAll(): void {
    const data = this.plugin.grammarUserData!;
    if (this.kind === "known") data.clearKnownWords();
    else data.clearIgnoredRules();
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-project-modal");

    const header = contentEl.createDiv({ cls: "feuillets-modal-header-row" });
    header.createEl("h3", {
      text: this.kind === "known" ? t("settings.knownWords.name") : t("settings.ignoredRules.name"),
    });
    if (this.entries.length > 0) {
      const clearBtn = header.createDiv({ cls: "feuillets-project-actions" });
      const btn = clearBtn.createEl("button", { cls: "clickable-icon" });
      setIcon(btn, "trash-2");
      btn.setAttr("aria-label", t("modal.grammarUserData.clearAllAria"));
      btn.addEventListener("click", () => {
        this.clearAll();
        new Notice(t("modal.grammarUserData.cleared"));
        this.render();
      });
    }

    if (this.entries.length === 0) {
      contentEl.createDiv({ cls: "feuillets-empty" }).setText(
        this.kind === "known" ? t("settings.knownWords.empty") : t("settings.ignoredRules.empty")
      );
      return;
    }

    const searchWrap = contentEl.createDiv({ cls: "feuillets-tags-search-bar" });
    const searchInput = searchWrap.createEl("input", {
      type: "text",
      cls: "feuillets-tags-search",
      attr: { placeholder: t("modal.grammarUserData.filterPlaceholder") },
    });
    searchInput.value = this.search;

    const list = contentEl.createDiv({ cls: "feuillets-project-list" });

    const renderList = (): void => {
      list.empty();
      const term = this.search.trim().toLowerCase();
      const filtered = [...this.entries]
        .sort((a, b) => this.labelFor(a).localeCompare(this.labelFor(b), "fr"))
        .filter((entry) => !term || this.labelFor(entry).toLowerCase().includes(term));

      if (filtered.length === 0) {
        list.createDiv({ cls: "feuillets-empty" }).setText(t("modal.grammarUserData.noMatch"));
        return;
      }

      for (const entry of filtered) {
        const row = list.createDiv({ cls: "feuillets-project-item" });
        row.createSpan({ cls: "feuillets-project-name", text: this.labelFor(entry) });
        const del = row.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
        setIcon(del, "x");
        del.setAttr("aria-label", t("modal.grammarUserData.removeAria"));
        del.addEventListener("click", () => {
          this.remove(entry);
          renderList();
        });
      }
    };

    searchInput.addEventListener("input", () => {
      this.search = searchInput.value;
      renderList();
    });

    renderList();

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow.createEl("button", { text: t("modal.close") }).addEventListener("click", () => this.close());
  }
}
