const { ItemView, MarkdownRenderer, TFolder, TFile, MarkdownView, setIcon } = require("obsidian");

import { VIEW_NOTES } from "../constants.js";
import { foldAccents } from "../utils/core.js";
import { iconBtn } from "../utils/dom.js";

function getNotesSectionIcon(title) {
  return {
    "Synopsis": "align-left",
    "Résumé": "file-text",
    "Notes": "sticky-note"
  }[title] || "info";
}

export class NotesView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentPath = null;
    this.viewedFile = null;
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
        // Réinitialise le fichier visualisé si on ouvre un autre fichier différent dans l'éditeur
        if (newFile && (!this.viewedFile || newFile.path !== this.viewedFile.path)) {
          this.viewedFile = null;
        }
        /* forcé : le fichier actif a changé, il faut refléter le nouveau
           quel que soit l'état du focus — sans ça, si le curseur était
           resté dans un champ de CE panneau (Synopsis, Notes…) au moment
           de cliquer un autre feuillet ailleurs, le panneau restait figé
           sur l'ancien fichier jusqu'à ce qu'on clique dessus pour lui
           rendre le focus. Le garde-fou plus bas reste utile pour les
           rafraîchissements du MÊME fichier (vault "modify"/metadataCache
           "changed"), où il évite de couper une frappe en cours. */
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
    await this.render();
  }
  async render(force = false) {
    const S = this.plugin.settings;
    const container = this.contentEl;
    const a = document.activeElement;
    if (!force && a && container.contains(a) && ["TEXTAREA", "INPUT"].includes(a.tagName))
      return;
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
    const fm = this.plugin.fmOf(file);

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

    const sceneDate = this.plugin.parseStoryDate(fm.date, file);
    if (sceneDate) {
      const chronoFolder = this.plugin.getChronoFolder();
      if (chronoFolder instanceof TFolder) {
        const matches = [];
        const walk = (cf) => {
          for (const c of cf.children) {
            if (c instanceof TFolder) walk(c);
            else if (c instanceof TFile && c.extension === "md") {
              const d = this.plugin.parseStoryDate(this.plugin.fmOf(c).date, c);
              if (d && d.sort === sceneDate.sort) matches.push(c);
            }
          }
        };
        walk(chronoFolder);
        for (const jalon of matches) {
          const box = wrapper.createDiv({ cls: "feuillets-notes-milestone" });
          const bHead = box.createDiv({ cls: "feuillets-notes-milestone-head" });
          bHead.setText(`◆ ${this.plugin.titleFor(jalon)} — ${sceneDate.display}`);
          bHead.setAttr("title", "Jalon historique (_Chronologie) — cliquer pour ouvrir");
          bHead.addEventListener("click", () => {
            this.app.workspace.getLeaf(false).openFile(jalon);
          });
          const bBody = box.createDiv({ cls: "feuillets-notes-milestone-body" });
          const raw = await this.app.vault.cachedRead(jalon);
          const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
          if (body) {
            await MarkdownRenderer.render(this.app, body, bBody, jalon.path, this);
          } else {
            bBody.setText("(jalon sans contenu)");
          }
        }
      }
    }

    const tags = this.plugin.tagsOf(file);
    if (tags.length > 0) {
      const tagRow = wrapper.createDiv({ cls: "feuillets-tags" });
      for (const t of tags) {
        tagRow.createSpan({ cls: "feuillets-tag-chip" }).setText(`#${t}`);
      }
    }

    if (S.notesShowEntities) {
      await this.renderCitedEntities(wrapper, file, sceneDate);
    }

    const mode = this.plugin.projectMode();
    const isFiction = mode ? (mode.yamlPreset === "roman" || mode.yamlPreset === "nouvelle") : true;

    const order = S.notesSectionOrder || ["Synopsis", "Résumé", "Notes"];
    for (const sectionName of order) {
      if (sectionName === "Synopsis" && S.notesShowSynopsis && isFiction) {
        this.renderCollapsibleTextarea(wrapper, "Synopsis", "synopsis", file, fm, "Accroche courte…", 3);
      } else if (sectionName === "Résumé" && S.notesShowResume && !isFiction) {
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
      link.createSpan().setText(folder.name);
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

  async renderCitedEntities(container, file, sceneDate) {
    const S = this.plugin.settings;
    const collapseKey = "notes:field:contexte";
    const collapsed = !!S.collapsed[collapseKey];

    const researchRoot = this.plugin.getResearchRoot();
    if (!researchRoot) return;

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
    walk(researchRoot);

    const raw = await this.app.vault.cachedRead(file);
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");

    const citedSet = new Set();

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
      const aliases = this.plugin.fmOf(ent)?.aliases || [];
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

    const ORDER = ["personnage", "lieu", "evenement", "codex", null];
    const LABEL = {
      personnage: "Personnages",
      lieu: "Lieux",
      evenement: "Événements",
      codex: "Codex",
      null: "Autres fiches",
    };
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

    let lastKind = undefined;
    for (const ent of entities) {
      const efm = this.plugin.fmOf(ent);
      const kind = this.entityKind(ent);

      if (kind !== lastKind) {
        box
          .createDiv({ cls: "feuillets-entity-group" })
          .setText(LABEL[String(kind)]);
        lastKind = kind;
      }

      const row = box.createDiv({ cls: "feuillets-entity-row" });
      const head = row.createDiv({ cls: "feuillets-entity-head" });
      const nameEl = head.createSpan({ cls: "feuillets-entity-name" });
      nameEl.setText(`• ${this.plugin.titleFor(ent)}`);
      nameEl.addEventListener("click", () => {
        this.app.workspace.getLeaf(false).openFile(ent);
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
