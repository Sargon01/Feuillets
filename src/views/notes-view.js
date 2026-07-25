const { TFile, TFolder, setIcon } = require("obsidian");

import { VIEW_NOTES } from "../constants.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { foldAccents } from "../utils/core.js";
import { latestStateBefore } from "../utils/entity-states.js";
import { isEditing, openFileActivating } from "../utils/dom.js";
import { ProjectPropertiesModal, ProjectTagsModal } from "../ui/project-properties-modals.js";
import { FRONT_PAGE_TYPES } from "../services/folder-structure.js";

function getNotesSectionIcon(title) {
  return {
    "Synopsis": "align-left",
    "Résumé": "file-text",
    "Notes": "sticky-note"
  }[title] || "info";
}

/** Icônes par type de propriété, même esprit que le panneau natif
 * Propriétés d'Obsidian — repris de l'ancien onglet Propriétés
 * (properties-view.js), fusionné ici (voir renderFilePropertiesSection). */
const TYPE_ICONS = {
  text: "text",
  list: "list",
  number: "hash",
  checkbox: "check-square",
  date: "calendar",
  datetime: "calendar-clock",
};

function inferPropertyType(value) {
  if (typeof value === "boolean") return "checkbox";
  if (Array.isArray(value)) return "list";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return "datetime";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
  }
  return "text";
}

export class NotesView extends BaseFeuilletsView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
    this.viewedFile = null; // note de dossier consultée
    this.currentPath = null;
  }

  getViewType() {
    return VIEW_NOTES;
  }
  getDisplayText() {
    return "Notes du feuillet";
  }
  getIcon() {
    return "sticky-note";
  }

  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("file-open", (newFile) => {
        /* forcé : le fichier actif a changé, il faut refléter le nouveau
           quel que soit l'état du focus — sans ça, si le curseur était
           resté dans un champ de CE panneau (Synopsis, Notes…) au moment
           de cliquer un autre feuillet ailleurs, le panneau restait figé
           sur l'ancien fichier jusqu'à ce qu'on clique dessus pour lui
           rendre le focus. Le garde-fou plus bas reste utile pour les
           rafraîchissements du MÊME fichier (vault "modify"/metadataCache
           "changed"), où il évite de couper une frappe en cours. */
        if (newFile && (!this.viewedFile || newFile.path !== this.viewedFile.path)) {
          this.viewedFile = null;
        }
        this.render(true);
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        const targetPath = this.viewedFile ? this.viewedFile.path : this.currentPath;
        if (file.path === targetPath) this.render();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        const targetPath = this.viewedFile ? this.viewedFile.path : this.currentPath;
        if (file.path === targetPath) this.render();
      })
    );
    await this.render(true);
  }

  async render(force = false) {
    const S = this.plugin.settings;
    const container = this.targetContainer || this.contentEl;
    if (!force && isEditing(container)) return;
    container.empty();

    const wrapper = container.createDiv({ cls: "feuillets-notes-container" });

    const activeFile = this.app.workspace.getActiveFile();
    let file = this.viewedFile || activeFile;
    if (this.viewedFile) {
      const exists = this.app.vault.getAbstractFileByPath(this.viewedFile.path);
      if (!exists) {
        this.viewedFile = null;
        file = activeFile;
      }
    }

    const root = this.plugin.getProjectFolder();
    if (!file || !root || !file.path.startsWith(root.path + "/")) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText("Ouvre un feuillet du projet pour voir ses notes.");
      this.currentPath = null;
      return;
    }
    this.currentPath = file.path;
    const fm = this.fm(file);

    // Barre de retour si on consulte une note de dossier
    if (this.viewedFile && activeFile && this.viewedFile.path !== activeFile.path) {
      const backBar = wrapper.createDiv({ cls: "feuillets-notes-back-bar" });
      const backBtn = backBar.createEl("button", {
        cls: "feuillets-back-btn",
        text: " Retour au feuillet"
      });
      const iconSpan = backBtn.createSpan({ cls: "feuillets-back-icon" });
      setIcon(iconSpan, "arrow-left");
      backBtn.prepend(iconSpan);
      backBtn.addEventListener("click", () => {
        this.viewedFile = null;
        this.render();
      });
    }

    this.renderFolderNoteLinks(wrapper, file);
    this.renderFilePropertiesSection(wrapper, file);

    const sceneDate = this.plugin.parseStoryDate(fm.date, file);
    const jalons = [];
    if (sceneDate) {
      const chronoFolder = this.plugin.getChronoFolder();
      if (chronoFolder instanceof TFolder) {
        const walk = (cf) => {
          for (const c of cf.children) {
            if (c instanceof TFolder) walk(c);
            else if (c instanceof TFile && c.extension === "md") {
              const d = this.plugin.parseStoryDate(this.fm(c).date, c);
              if (d && d.sort === sceneDate.sort) jalons.push(c);
            }
          }
        };
        walk(chronoFolder);
      }
    }

    if (S.notesShowEntities) {
      await this.renderCitedEntities(wrapper, file, sceneDate, jalons);
    }

    const order = S.notesSectionOrder || ["Synopsis", "Résumé", "Notes"];
    for (const sectionName of order) {
      if (sectionName === "Synopsis" && S.notesShowSynopsis) {
        this.renderCollapsibleTextarea(wrapper, "Synopsis", "synopsis", file, fm, "Accroche courte…", 3);
      } else if (sectionName === "Résumé" && S.notesShowResume) {
        this.renderCollapsibleTextarea(wrapper, "Résumé", "resume", file, fm, "Déroulé long…", 5);
      } else if (sectionName === "Notes" && S.notesShowNotes) {
        this.renderCollapsibleTextarea(wrapper, "Notes", "notes", file, fm, "Notes de travail — jamais compilées ni comptées.", 8);
      }
    }

    if (this.plugin.hasSources()) {
      this.renderCollapsibleTextarea(wrapper, "Sources", "sources", file, fm, "Références, lectures, entretiens…", 4);
    }
  }

  latestStateBefore(content, year) {
    const re = /^\s*(?:[-*+]\s*)?\**\s*(-?\d{3,4})\s*\**\s*[:：–—-]\s*(.+)$/;
    let best = null;
    for (const line of content.split("\n")) {
      const m = line.match(re);
      if (!m) continue;
      const y = parseInt(m[1], 10);
      if (y > year) continue;
      if (!best || y > best.y) best = { y, text: m[2].trim() };
    }
    return best;
  }

  entityKind(ent) {
    const tags = this.plugin.tagsOf(ent).map((t) => foldAccents(t));
    if (tags.includes("personnage")) return "personnage";
    if (tags.includes("lieu")) return "lieu";
    if (tags.includes("evenement")) return "evenement";
    if (tags.includes("codex")) return "codex";
    return null;
  }

  /** Propriétés du fichier ouvert — reprise de l'ancien onglet Propriétés
   * (properties-view.js), placée en première section pour ne plus avoir à
   * basculer entre l'onglet Notes et l'onglet Propriétés en permanence.
   * Les deux icônes ("Propriétés du projet"/"Tags du projet") ouvrent en
   * fenêtre flottante ce qui restait de cet onglet (vue project-wide,
   * navigable jusqu'aux fichiers). */
  renderFilePropertiesSection(wrapper, file) {
    const section = wrapper.createDiv({ cls: "feuillets-notes-section" });
    const collapsed = this.renderSectionHead(
      section,
      "file-text",
      "Propriétés",
      "notes",
      "proprietes-fichier",
      (actions) => {
        this.iconBtn(actions, "list-tree", "Propriétés du projet…", () =>
          new ProjectPropertiesModal(this.app, this.plugin).open()
        );
        this.iconBtn(actions, "tags", "Tags du projet…", () =>
          new ProjectTagsModal(this.app, this.plugin).open()
        );
      }
    );
    if (collapsed) return;

    const fm = this.fm(file);
    const isFront = this.plugin.isFrontMatter(file);
    if (isFront) this.renderFrontPageTypeRow(section, file, fm);

    const list = section.createDiv({ cls: "feuillets-properties-list" });
    for (const key of Object.keys(fm)) {
      if (isFront && key === "type") continue; // remplacé par le sélecteur dédié ci-dessus
      this.renderPropertyRow(list, file, key, fm[key]);
    }

    const addRow = section.createDiv({ cls: "feuillets-properties-add-row" });
    const input = addRow.createEl("input", {
      type: "text",
      attr: { placeholder: "Nouvelle propriété…" },
    });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const key = input.value.trim();
      if (!key) return;
      await this.app.fileManager.processFrontMatter(file, (data) => {
        if (!(key in data)) data[key] = "";
      });
      await this.render(true);
      const added = section.querySelector(
        `.feuillets-properties-row[data-key="${CSS.escape(key)}"] .feuillets-properties-value`
      );
      if (added) added.focus();
    });
  }

  /** Sélecteur dédié pour le champ `type` d'une page du dossier Front
   * (titre/dédicace/épigraphe) — évite de faire dépendre la mise en page
   * spéciale à l'export d'une valeur tapée à la main dans l'éditeur de
   * propriétés générique (typo, majuscule, "titlepage" au lieu de "titre"…
   * silencieusement retombé en page normale). Voir FRONT_PAGE_TYPES et
   * isFrontMatter dans folder-structure.js, et la détection dans
   * compile-export.js. */
  renderFrontPageTypeRow(section, file, fm) {
    const row = section.createDiv({ cls: "feuillets-properties-row" });
    const iconEl = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(iconEl, "book-open-text");
    row.createSpan({ cls: "feuillets-properties-key" }).setText("Type de page Front");

    const select = row.createEl("select", { cls: "feuillets-properties-value" });
    select.createEl("option", { text: "— page normale (pas de mise en forme spéciale) —", value: "" });
    const LABELS = { titre: "Page de titre", dedicace: "Dédicace", epigraphe: "Épigraphe" };
    for (const t of FRONT_PAGE_TYPES) {
      select.createEl("option", { text: LABELS[t] || t, value: t });
    }
    const current = typeof fm.type === "string" ? fm.type.trim().toLowerCase() : "";
    select.value = FRONT_PAGE_TYPES.includes(current) ? current : "";
    select.addEventListener("change", async () => {
      await this.app.fileManager.processFrontMatter(file, (data) => {
        if (select.value) data.type = select.value;
        else delete data.type;
      });
      await this.render(true);
    });
  }

  renderPropertyRow(list, file, key, value) {
    const type = inferPropertyType(value);
    const row = list.createDiv({ cls: "feuillets-properties-row" });
    row.setAttr("data-key", key);
    const iconEl = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(iconEl, TYPE_ICONS[type] || "text");
    row.createSpan({ cls: "feuillets-properties-key" }).setText(key);

    if (type === "checkbox") {
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = value;
      cb.addEventListener("change", async () => {
        await this.app.fileManager.processFrontMatter(file, (data) => {
          data[key] = cb.checked;
        });
      });
    } else if (type === "list") {
      this.renderListEditor(row, file, key, value);
    } else if (type === "date" || type === "datetime") {
      const input = row.createEl("input", {
        type: type === "date" ? "date" : "datetime-local",
        cls: "feuillets-properties-value",
      });
      input.value = value;
      input.addEventListener("change", async () => {
        await this.app.fileManager.processFrontMatter(file, (data) => {
          if (!input.value) delete data[key];
          else data[key] = input.value;
        });
      });
    } else {
      const input = row.createEl("input", { type: "text", cls: "feuillets-properties-value" });
      input.value = value === undefined || value === null ? "" : String(value);
      const save = async () => {
        const raw = input.value;
        await this.app.fileManager.processFrontMatter(file, (data) => {
          if (raw.trim() === "") {
            delete data[key];
            return;
          }
          if (type === "number") {
            const num = Number(raw);
            data[key] = Number.isNaN(num) ? raw : num;
          } else {
            data[key] = raw;
          }
        });
      };
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
    }

    const delBtn = row.createSpan({ cls: "feuillets-properties-delete" });
    setIcon(delBtn, "x");
    delBtn.setAttr("aria-label", `Supprimer « ${key} »`);
    delBtn.addEventListener("click", async () => {
      await this.app.fileManager.processFrontMatter(file, (data) => {
        delete data[key];
      });
      await this.render(true);
    });
  }

  /** Éditeur à jetons (façon liste de tags) pour une propriété liste —
   * même vocabulaire visuel que l'éditeur de tags natif du plugin. */
  renderListEditor(row, file, key, values) {
    const wrap = row.createDiv({ cls: "feuillets-tags feuillets-properties-list-editor" });
    values.forEach((v, idx) => {
      const chip = wrap.createSpan({ cls: "feuillets-tag-chip" });
      chip.setText(String(v));
      chip.setAttr("title", "Cliquer pour retirer");
      chip.addEventListener("click", async () => {
        const next = values.filter((_, i) => i !== idx);
        await this.app.fileManager.processFrontMatter(file, (data) => {
          if (next.length === 0) delete data[key];
          else data[key] = next;
        });
      });
    });
    const input = wrap.createEl("input", {
      cls: "feuillets-tags-input",
      type: "text",
      attr: { placeholder: values.length ? "+" : "+ valeur" },
    });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const raw = input.value.trim();
      if (!raw) return;
      const added = raw.split(",").map((s) => s.trim()).filter(Boolean);
      await this.app.fileManager.processFrontMatter(file, (data) => {
        data[key] = [...values, ...added];
      });
      input.value = "";
      input.blur();
    });
  }

  renderFolderNoteLinks(container, file) {
    const root = this.plugin.getProjectFolder();
    if (!root) return;

    const chain = [];
    let cur = file.parent;
    while (cur instanceof TFolder && cur.path.startsWith(root.path)) {
      const role = this.plugin.roleOfFolder(cur);
      if (role === "chapitre" || role === "partie") {
        chain.push(cur);
      }
      if (cur.path === root.path) break;
      cur = cur.parent;
    }
    if (chain.length === 0) return;
    chain.reverse(); // partie d'abord, puis chapitre

    const box = container.createDiv({ cls: "feuillets-notes-folder-links" });
    for (const folder of chain) {
      const link = box.createDiv({ cls: "feuillets-notes-folder-link" });
      const icon = link.createSpan({ cls: "feuillets-notes-folder-link-icon" });
      setIcon(icon, "notebook-text");
      link.createSpan({ cls: "feuillets-notes-folder-link-name" }).setText(folder.name);
      link.setAttr("title", `Note de « ${folder.name} »`);
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        const note = await this.plugin.getOrCreateFolderNote(folder);
        if (note) {
          this.viewedFile = note;
          this.render();
        }
      });
    }
  }

  async renderCitedEntities(container, file, sceneDate, jalons = []) {
    const S = this.plugin.settings;
    const collapseKey = "notes:field:contexte";
    const collapsed = !!S.collapsed[collapseKey];

    const researchRoot = this.plugin.getResearchRoot();
    if (!researchRoot && jalons.length === 0) return;

    const projectEntities = [];
    const walk = (folder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          walk(child);
        } else if (child instanceof TFile && child.extension === "md") {
          projectEntities.push(child);
        }
      }
    };
    if (researchRoot) walk(researchRoot);

    const raw = await this.app.vault.cachedRead(file);
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");

    const citedSet = new Set();
    for (const jalon of jalons) citedSet.add(jalon);

    const linkRe = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    let m;
    while ((m = linkRe.exec(body)) !== null) {
      const linkText = m[1].trim().toLowerCase();
      const match = projectEntities.find(
        (ent) =>
          ent.basename.toLowerCase() === linkText ||
          this.plugin.titleFor(ent).toLowerCase() === linkText
      );
      if (match) {
        citedSet.add(match);
      }
    }

    const sortedForRegex = [...projectEntities].sort((a, b) => {
      const lenA = Math.max(a.basename.length, this.plugin.titleFor(a).length);
      const lenB = Math.max(b.basename.length, this.plugin.titleFor(b).length);
      return lenB - lenA;
    });

    for (const ent of sortedForRegex) {
      if (citedSet.has(ent)) continue;

      const title = this.plugin.titleFor(ent);
      const basename = ent.basename;
      const aliases = this.fm(ent)?.aliases || [];
      const aliasList = (Array.isArray(aliases) ? aliases : [aliases]).map(String).filter(Boolean);

      const candidates = [title, basename, ...aliasList]
        .map((name) => name.trim())
        .filter((name) => name.length >= 3);

      if (candidates.length === 0) continue;

      const escapedCandidates = candidates.map(c => c.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
      const pattern = "(?:^|[^a-zA-Z0-9À-ÖØ-öø-ÿ])(" + escapedCandidates.join("|") + ")(?:$|[^a-zA-Z0-9À-ÖØ-öø-ÿ])";
      const regex = new RegExp(pattern, "i");

      if (regex.test(body)) {
        citedSet.add(ent);
      }
    }

    const entities = [...citedSet];
    if (entities.length === 0) return;

    /* Regroupées par nature (personnage/lieu/événement/codex) sans le
       préciser visuellement : inutile de l'expliciter, la nature de
       chaque fiche est déjà évidente au premier coup d'œil (nom, âge
       éventuel...). */
    const ORDER = ["personnage", "lieu", "evenement", "codex", null];
    entities.sort(
      (a, b) => ORDER.indexOf(this.entityKind(a)) - ORDER.indexOf(this.entityKind(b))
    );

    // Collapsible header matching the others
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    const headSection = section.createDiv({ cls: "feuillets-notes-section-head" });

    const iconSpan = headSection.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(iconSpan, "book-open");

    const sectionTitle = sceneDate ? `Contexte (${sceneDate.display})` : "Contexte";
    headSection.createSpan({ cls: "feuillets-notes-section-title" }).setText(sectionTitle);

    headSection.addEventListener("click", async () => {
      if (collapsed) delete S.collapsed[collapseKey];
      else S.collapsed[collapseKey] = true;
      await this.plugin.saveSettings();
      this.render();
    });

    if (collapsed) return;

    const box = section.createDiv({ cls: "feuillets-notes-entities-body", style: "margin-top: 6px;" });

    for (const ent of entities) {
      const efm = this.fm(ent);
      const kind = this.entityKind(ent);

      const row = box.createDiv({ cls: "feuillets-entity-row" });
      const head = row.createDiv({ cls: "feuillets-entity-head" });
      const nameEl = head.createSpan({ cls: "feuillets-entity-name" });
      nameEl.setText(`• ${this.plugin.titleFor(ent)}`);
      nameEl.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), ent);
      });

      if (kind === "personnage" && sceneDate) {
        const birth = this.plugin.parseStoryDate(efm.naissance ?? efm.birth);
        const death = this.plugin.parseStoryDate(efm.mort ?? efm.death);
        if (death && sceneDate.sort > death.sort) {
          const diff = sceneDate.y - death.y;
          let text = `mort en ${death.y}`;
          if (diff > 0) {
            text = `mort depuis ${diff} ${diff > 1 ? "ans" : "an"} (en ${death.y})`;
          }
          head
            .createSpan({ cls: "feuillets-entity-age" })
            .setText(text);
        } else if (birth) {
          const age = sceneDate.y - birth.y;
          if (age >= 0) {
            head
              .createSpan({ cls: "feuillets-entity-age" })
              .setText(`~${age} ans`);
          }
        }
      }

      const info = row.createDiv({ cls: "feuillets-entity-info" });
      let shown = false;
      if (sceneDate && kind !== "codex") {
        const content = await this.app.vault.cachedRead(ent);
        const state = this.latestStateBefore(content, sceneDate.y);
        if (state) {
          info.setText(state.text);
          info.setAttr("title", `État renseigné en ${state.y}`);
          if (state.y !== sceneDate.y) {
            info
              .createSpan({ cls: "feuillets-entity-since" })
              .setText(` (depuis ${state.y})`);
          }
          shown = true;
        }
      }
      if (!shown && efm.synopsis) {
        info.setText(String(efm.synopsis).trim());
      } else if (!shown && !efm.synopsis) {
        info.remove();
      }
    }
  }

  /** Notes de bas de page (`[^label]: texte`) définies dans le corps du
   * feuillet — lecture seule (le contenu vit dans le corps du texte, pas
   * dans le frontmatter, contrairement aux autres rubriques de ce
   * panneau) : cliquer une entrée ouvre le feuillet à l'endroit de sa
   * définition plutôt que de proposer une édition qui serait trompeuse. */
  async renderFootnotesSection(container, file) {
    const S = this.plugin.settings;
    const collapseKey = "notes:field:footnotes";
    const collapsed = !!S.collapsed[collapseKey];

    const raw = await this.app.vault.cachedRead(file);
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");

    const footnotes = [];
    const re = /^\[\^([^\]]+)\]:[ \t]*(.+)$/gm;
    let m;
    while ((m = re.exec(body)) !== null) {
      footnotes.push({ label: m[1], text: m[2].trim() });
    }
    if (footnotes.length === 0) return;

    const section = container.createDiv({ cls: "feuillets-notes-section" });
    const head = section.createDiv({ cls: "feuillets-notes-section-head" });

    const iconSpan = head.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(iconSpan, "list");

    head.createSpan({ cls: "feuillets-notes-section-title" }).setText("Notes de bas de page");

    head.addEventListener("click", async () => {
      if (collapsed) delete S.collapsed[collapseKey];
      else S.collapsed[collapseKey] = true;
      await this.plugin.saveSettings();
      this.render();
    });

    if (collapsed) return;

    const list = section.createDiv({ cls: "feuillets-notes-field-container" });
    for (const fn of footnotes) {
      const row = list.createDiv({ cls: "feuillets-flat-text-cell" });
      row.createSpan({ cls: "feuillets-entity-name" }).setText(`[^${fn.label}] `);
      row.createSpan().setText(fn.text);
      row.style.cursor = "pointer";
      row.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });
    }
  }

  renderCollapsibleTextarea(container, label, key, file, fm, placeholder, rows) {
    const S = this.plugin.settings;
    const collapseKey = `notes:field:${key}`;
    const collapsed = !!S.collapsed[collapseKey];

    const section = container.createDiv({ cls: "feuillets-notes-section" });
    const head = section.createDiv({ cls: "feuillets-notes-section-head" });

    const iconSpan = head.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(iconSpan, getNotesSectionIcon(label));

    head.createSpan({ cls: "feuillets-notes-section-title" }).setText(label);

    head.addEventListener("click", async () => {
      if (collapsed) delete S.collapsed[collapseKey];
      else S.collapsed[collapseKey] = true;
      await this.plugin.saveSettings();
      this.render();
    });

    if (collapsed) return;

    const list = section.createDiv({ cls: "feuillets-notes-field-container" });
    const value = fm[key] || "";

    const textEl = list.createDiv({
      cls: "feuillets-flat-text-cell" + (value ? "" : " is-empty"),
      text: value || placeholder,
      style: "white-space: pre-wrap; min-height: 24px; cursor: pointer; padding: 4px 8px; border-radius: var(--radius-s);"
    });

    textEl.addEventListener("click", (e) => {
      e.stopPropagation();
      textEl.style.display = "none";

      const ta = list.createEl("textarea", {
        cls: "feuillets-flat-textarea",
        attr: { placeholder, rows: String(rows) }
      });
      ta.value = fm[key] || "";
      ta.focus();

      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";

      const saveAndExit = async () => {
        if (ta.parentNode) {
          const newVal = ta.value.trim();
          if (newVal !== (fm[key] || "")) {
            await this.app.fileManager.processFrontMatter(file, (x) => {
              if (newVal) x[key] = newVal;
              else delete x[key];
            });
            textEl.setText(newVal || placeholder);
            if (newVal) textEl.removeClass("is-empty");
            else textEl.addClass("is-empty");
          }
          ta.remove();
          textEl.style.display = "";
        }
      };

      ta.addEventListener("blur", saveAndExit);
      ta.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" || (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey))) {
          ta.blur();
        }
      });
    });
  }
}
