import { YAML_PRESETS } from "../scenes-editor.js";
import { BOARD_MODES, HIDEABLE_PANELS } from "../constants.js";
import { resolveType } from "../utils/project-modes.js";
import { NewProjectModal, ManageProjectsModal } from "../ui/project-modals.js";
import { ScrivenerImportModal } from "../ui/scrivener-import-modal.js";
const { PluginSettingTab, Setting, TFolder, Notice, Menu } = require("obsidian");

export class FeuilletsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const S = this.plugin.settings;
    const mode = this.plugin.projectMode();
    const unit = this.plugin.unitLabel();
    const unitPlural = this.plugin.unitLabelPlural();
    containerEl.empty();
    containerEl.createEl("h2", { text: "Feuillets" });

    const refresh = () => this.plugin.refreshView();

    containerEl.createEl("h3", { text: "Dossier & Gestion des projets", attr: { "data-cat": "Projet" } });

    const allProjects = (S.projects || []).concat(S.projectFolder ? [S.projectFolder] : [])
      .filter((p, i, a) => p && a.indexOf(p) === i)
      .sort((a, b) =>
        this.plugin.projectDisplayName(a).localeCompare(
          this.plugin.projectDisplayName(b), "fr", { sensitivity: "base" }
        )
      );

    // Dropdown pour choisir le projet actif
    new Setting(containerEl)
      .setName("Projet actif")
      .setDesc("Sélectionne le projet sur lequel travailler dans le coffre.")
      .addDropdown((d) => {
        d.addOption("", "— Aucun projet actif —");
        for (const p of allProjects) {
          const folderObj = this.app.vault.getAbstractFileByPath(p);
          const exists = folderObj instanceof TFolder;
          d.addOption(
            p,
            exists
              ? this.plugin.projectDisplayName(p)
              : `${this.plugin.projectDisplayName(p)} (introuvable)`
          );
        }
        d.setValue(S.projectFolder || "");
        d.onChange(async (v) => {
          if (v && !(this.app.vault.getAbstractFileByPath(v) instanceof TFolder)) {
            new Notice(`Le dossier « ${v} » n'existe plus dans le coffre.`);
            d.setValue(S.projectFolder || "");
            return;
          }
          S.projectFolder = v;
          await this.plugin.saveSettings();
          this.plugin.updateStatusBar();
          this.plugin.renderAllViews(true);
          this.display();
        });
      });

    // Champ texte pour saisir / éditer le chemin directement
    new Setting(containerEl)
      .setName("Chemin du dossier projet (Manuscrit)")
      .setDesc("Chemin relatif dans le coffre. Ex: Roman1/Manuscrit")
      .addText((t) => {
        t.setValue(S.projectFolder || "");
        t.setPlaceholder("Roman1/Manuscrit");
        t.onChange(async (v) => {
          const val = v.trim();
          S.projectFolder = val;
          if (val && !(S.projects || []).includes(val)) {
            if (!S.projects) S.projects = [];
            S.projects.push(val);
          }
          await this.plugin.saveSettings();
          this.plugin.updateStatusBar();
          this.plugin.renderAllViews(true);
        });
      });

    // Boutons d'actions rapides (Créer, Importer Scrivener, Gérer la liste)
    const btnSetting = new Setting(containerEl)
      .setName("Actions de projet")
      .setDesc("Créer un nouveau projet structuré, importer un projet Scrivener, ou gérer la liste des projets.");

    btnSetting.addButton((b) => {
      b.setButtonText("Créer un projet")
        .setCta()
        .onClick(() => {
          new NewProjectModal(this.app, this.plugin).open();
        });
    });

    btnSetting.addButton((b) => {
      b.setButtonText("Importer Scrivener")
        .onClick(() => {
          new ScrivenerImportModal(this.app, this.plugin).open();
        });
    });

    btnSetting.addButton((b) => {
      b.setButtonText("Gérer la liste…")
        .onClick(() => {
          new ManageProjectsModal(this.app, this.plugin).open();
        });
    });

    /* garde-fou : un dossier projet mal pointé (ex. un cran trop haut,
       contenant _Recherche/_Snapshots à côté du vrai manuscrit) ne casse
       rien silencieusement — un avertissement explicite apparaît ici. */
    const root = this.plugin.getProjectFolder();
    if (root) {
      const count = this.plugin.chapterCount(root);
      if (count === 0) {
        const warn = containerEl.createDiv({ cls: "feuillets-empty" });
        warn.style.color = "var(--text-error)";
        warn.setText(
          `⚠ Aucun élément détecté dans « ${root.name} ». Si ton projet est vide, c'est normal. Sinon, vérifie que ce dossier pointe bien sur la racine de ton manuscrit (contenant directement tes chapitres ou tes feuillets, et non un dossier parent).`
        );
      }
      if (!S.projectMeta) S.projectMeta = {};
      if (!S.projectMeta[root.path]) {
        S.projectMeta[root.path] = { type: "fiction" };
      }
      const meta = S.projectMeta[root.path];
      if (!meta.labels) {
        meta.labels = JSON.parse(JSON.stringify(S.labels || []));
      }

      new Setting(containerEl)
        .setName("Type de projet")
        .setDesc("Détermine la terminologie du manuscrit (Fiction ou Non-fiction) et configure les modèles associés.")
        .addDropdown((d) => {
          d.addOption("fiction", "Fiction");
          d.addOption("nonfiction", "Non-fiction");
          d.setValue(resolveType(meta.type))
           .onChange(async (v) => {
             meta.type = v;
             await this.plugin.saveSettings();
             this.display(); // Recharger le panneau
             this.plugin.renderAllViews(true);
             refresh();
           });
        });

      if (resolveType(meta.type) === "nonfiction") {
        new Setting(containerEl)
          .setName("Style de citation")
          .setDesc(
            "Utilisé par la commande « Insérer une citation ». Note de bas de page : style notes-bibliographie (histoire, sciences humaines). Auteur-date : entre parenthèses dans le texte (sciences sociales)."
          )
          .addDropdown((d) =>
            d
              .addOption("footnote", "Note de bas de page")
              .addOption("parenthetical", "Auteur-date, entre parenthèses")
              .setValue(meta.citationStyle || "footnote")
              .onChange(async (v) => {
                meta.citationStyle = v;
                await this.plugin.saveSettings();
              })
          );
      }
    }

    new Setting(containerEl)
      .setName("Dossier des jalons historiques")
      .setDesc(
        "Relatif au dossier projet. L'ancien emplacement _Chronologie reste reconnu automatiquement."
      )
      .addText((t) =>
        t.setValue(S.chronoFolder).onChange(async (v) => {
          S.chronoFolder = v.trim() || "Recherche/Chronologie";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Dossier du journal")
      .setDesc(
        "Relatif au dossier projet, aux côtés de Recherche et Snapshots. Contient les notes quotidiennes ; le carnet compilé y est créé sous le nom « Journal d'écriture.md »."
      )
      .addText((t) =>
        t.setValue(S.journalFolder).onChange(async (v) => {
          S.journalFolder = v.trim() || "Journal";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Créer un projet d'exemple")
      .setDesc(
        "Génère un projet Feuillets complet, avec du contenu réel dans chaque panneau (chemin de fer, fils narratifs, Recherche, Journal…), pour explorer toutes les fonctionnalités du plugin. N'affecte pas ton projet actif."
      )
      .addButton((b) =>
        b.setButtonText("Créer un projet d'exemple").onClick((e) => {
          const menu = new Menu();
          menu.addItem((item) =>
            item.setTitle("Roman générique (Elira) — explique chaque champ").onClick(async () => {
              await this.plugin.createDemoProject("elira");
              this.display();
            })
          );
          menu.addItem((item) =>
            item
              .setTitle("Candide, ou l'Optimisme (Voltaire) — labels, fils & personnages")
              .onClick(async () => {
                await this.plugin.createDemoProject("candide");
                this.display();
              })
          );
          menu.showAtMouseEvent(e);
        })
      );

    containerEl.createEl("h3", { text: "Statuts & Labels", attr: { "data-cat": "Projet" } });

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      "Catégorisation par scène — filtrable dans le Binder, le Tableau et le Chemin de fer."
    );

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText("Statuts");

    if (!Array.isArray(S.statuses)) S.statuses = [];
    S.statuses.forEach((st, i) => {
      new Setting(containerEl)
        .setName(`Statut ${i + 1}`)
        .addText((t) =>
          t.setValue(st.name).onChange(async (v) => {
            st.name = v.trim() || `Statut ${i + 1}`;
            await this.plugin.saveSettings();
            refresh();
          })
        )
        .addColorPicker((c) =>
          c.setValue(st.color || "#888888").onChange(async (v) => {
            st.color = v;
            await this.plugin.saveSettings();
            refresh();
          })
        )
        .addExtraButton((b) =>
          b
            .setIcon("trash")
            .setTooltip("Supprimer ce statut")
            .onClick(async () => {
              S.statuses.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
              refresh();
            })
        );
    });

    new Setting(containerEl).addButton((b) =>
      b.setButtonText("Ajouter un statut").onClick(async () => {
        S.statuses.push({ name: `Statut ${S.statuses.length + 1}`, color: "#888888" });
        await this.plugin.saveSettings();
        this.display();
      })
    );

    const currentMeta = root ? S.projectMeta[root.path] : null;
    const projectLabels = currentMeta && currentMeta.labels ? currentMeta.labels : S.labels;

    if (root) {
      containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(`Labels de couleur — projet : ${root.name}`);
    }

    (projectLabels || []).forEach((l, i) => {
      new Setting(containerEl)
        .setName(`Label ${i + 1}`)
        .addText((t) =>
          t.setValue(l.name).onChange(async (v) => {
            l.name = v.trim() || `Label ${i + 1}`;
            await this.plugin.saveSettings();
            refresh();
          })
        )
        .addColorPicker((c) =>
          c.setValue(l.color).onChange(async (v) => {
            l.color = v;
            await this.plugin.saveSettings();
            refresh();
          })
        )
        .addExtraButton((b) =>
          b
            .setIcon("trash")
            .setTooltip("Supprimer ce label")
            .onClick(async () => {
              projectLabels.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
              refresh();
            })
        );
    });

    new Setting(containerEl).addButton((b) =>
      b.setButtonText("Ajouter un label").onClick(async () => {
        projectLabels.push({ name: `Label ${projectLabels.length + 1}`, color: "#888888" });
        await this.plugin.saveSettings();
        this.display();
      })
    );

    containerEl.createEl("h3", { text: "Objectifs", attr: { "data-cat": "Projet" } });

    new Setting(containerEl)
      .setName(`Objectif de mots par défaut (${unit}/chapitre-fichier)`)
      .addText((t) =>
        t.setValue(String(S.wordGoal)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.wordGoal = isNaN(n) ? 0 : n;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl).setName("Tolérance (± mots)").addText((t) =>
      t.setValue(String(S.tolerance)).onChange(async (v) => {
        const n = parseInt(v, 10);
        S.tolerance = isNaN(n) ? 0 : Math.max(0, n);
        await this.plugin.saveSettings();
        refresh();
      })
    );

    new Setting(containerEl)
      .setName("Objectif de mots du projet")
      .setDesc("0 pour ne pas afficher de barre de progression sur le total du projet, dans le panneau Journal & statistiques.")
      .addText((t) =>
        t.setValue(String(S.projectWordGoal)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.projectWordGoal = isNaN(n) ? 0 : Math.max(0, n);
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName("Date limite du projet")
      .setDesc("Date de fin d'écriture souhaitée (AAAA-MM-JJ) pour calculer automatiquement le quota quotidien de mots requis.")
      .addText((t) =>
        t
          .setPlaceholder("AAAA-MM-JJ")
          .setValue(S.deadlineDate || "")
          .onChange(async (v) => {
            S.deadlineDate = v.trim();
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(containerEl)
      .setName("Objectif de session (mots/jour)")
      .setDesc("0 pour désactiver l'affichage de progression quotidienne.")
      .addText((t) =>
        t.setValue(String(S.sessionGoal)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.sessionGoal = isNaN(n) ? 0 : Math.max(0, n);
          await this.plugin.saveSettings();
          refresh();
        })
      );

    containerEl.createEl("h3", { text: "Historique", attr: { "data-cat": "Projet" } });

    new Setting(containerEl)
      .setName("Rétention de l'historique (jours)")
      .setDesc("0 = illimité. Au-delà, les jours les plus anciens sont purgés.")
      .addText((t) =>
        t.setValue(String(S.statsRetention)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.statsRetention = isNaN(n) ? 120 : Math.max(0, n);
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "Sauvegarde", attr: { "data-cat": "Projet" } });

    new Setting(containerEl)
      .setName("Sauvegarde automatique")
      .setDesc("Copie .zip périodique de tout le projet actif dans _Backups (voisin du dossier manuscrit) — filet de sécurité en plus des versions manuelles.")
      .addToggle((t) =>
        t.setValue(S.backupEnabled).onChange(async (v) => {
          S.backupEnabled = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (S.backupEnabled) {
      new Setting(containerEl)
        .setName("Intervalle de sauvegarde (minutes)")
        .addText((t) =>
          t.setValue(String(S.backupIntervalMinutes)).onChange(async (v) => {
            const n = parseInt(v, 10);
            S.backupIntervalMinutes = isNaN(n) ? 30 : Math.max(1, n);
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("Nombre de sauvegardes conservées")
        .setDesc("Les plus anciennes sont supprimées automatiquement au-delà.")
        .addText((t) =>
          t.setValue(String(S.backupKeepCount)).onChange(async (v) => {
            const n = parseInt(v, 10);
            S.backupKeepCount = isNaN(n) ? 5 : Math.max(1, n);
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("Sauvegarder maintenant")
        .addButton((b) =>
          b.setButtonText("Sauvegarder").onClick(() => this.plugin.backupProjectNow())
        );
    }

    containerEl.createEl("h3", { text: "Apparence", attr: { "data-cat": "Écriture" } });

    new Setting(containerEl)
      .setName("Taille de police (px)")
      .addSlider((s) =>
        s
          .setLimits(10, 22, 1)
          .setValue(S.fontSize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.fontSize = v;
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(containerEl)
      .setName("Taille générale de l'interface (%)")
      .addSlider((s) =>
        s
          .setLimits(60, 160, 5)
          .setValue(S.uiScale)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.uiScale = v;
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(containerEl)
      .setName("Tags favoris")
      .setDesc(
        "Séparés par des virgules. Proposés en un clic dans la fenêtre de tags des tuiles."
      )
      .addTextArea((t) =>
        t
          .setValue((S.favoriteTags || []).join(", "))
          .onChange(async (v) => {
            S.favoriteTags = [
              ...new Set(
                v
                  .split(/[,\n]+/)
                  .map((x) => x.replace(/^#/, "").trim())
                  .filter(Boolean)
              ),
            ];
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Typographie à la frappe", attr: { "data-cat": "Écriture" } });

    new Setting(containerEl)
      .setName("Alinéas de paragraphe dans l'éditeur")
      .setDesc("Retrait de première ligne au début de chaque paragraphe, en édition et en lecture. Purement visuel : n'ajoute rien au texte ni au manuscrit compilé.")
      .addToggle((t) =>
        t.setValue(S.indentParagraphs).onChange(async (v) => {
          S.indentParagraphs = v;
          await this.plugin.saveSettings();
          this.plugin.applyIndentClass();
        })
      );

    new Setting(containerEl)
      .setName("Apostrophe typographique (' → ’)")
      .setDesc(
        "Comportements adaptés du plugin French Typos de Thierry Crouzet. Si French Typos est installé et actif, désactive l'un des deux pour éviter les doubles remplacements."
      )
      .addToggle((t) =>
        t.setValue(S.liveApostrophe).onChange(async (v) => {
          S.liveApostrophe = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Guillemets français (" → « »)')
      .setDesc("Contextuels : ouvrant en début de mot, fermant après un mot — avec espaces insécables.")
      .addToggle((t) =>
        t.setValue(S.liveGuillemets).onChange(async (v) => {
          S.liveGuillemets = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Tirets (-- → –, --- → —)")
      .setDesc("Converti à la frappe de l'espace qui suit, avec espace insécable.")
      .addToggle((t) =>
        t.setValue(S.liveDashes).onChange(async (v) => {
          S.liveDashes = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Entrée = nouveau paragraphe")
      .setDesc(
        "La touche Entrée insère une ligne vide (saut de paragraphe). Ignoré dans les listes, titres, citations et blocs de code. Maj+Entrée pour un simple saut de ligne."
      )
      .addToggle((t) =>
        t.setValue(S.liveTwoEnters).onChange(async (v) => {
          S.liveTwoEnters = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Double Entrée = espace visible")
      .setDesc(
        "Appuyer deux fois sur Entrée insère une ligne d'espace insécable : un blanc visible entre deux paragraphes, qui reste affiché même quand les lignes vides sont en mode réduit ou invisible."
      )
      .addToggle((t) =>
        t.setValue(S.liveDoubleEnter).onChange(async (v) => {
          S.liveDoubleEnter = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Affichage des lignes vides")
      .setDesc("Réduit ou masque visuellement les lignes vides dans l'éditeur (le fichier n'est pas modifié).")
      .addDropdown((d) =>
        d
          .addOption("normal", "Normal")
          .addOption("reduit", "Réduit")
          .addOption("invisible", "Invisible")
          .setValue(S.liveEmptyLines)
          .onChange(async (v) => {
            S.liveEmptyLines = v;
            await this.plugin.saveSettings();
            this.plugin.applyLiveTypoClasses();
          })
      );

    new Setting(containerEl)
      .setName("Texte justifié et césure française")
      .setDesc("Mode lecture uniquement. Testé aussi en Live Preview, retiré : ça y cassait soit le défilement, soit le placement du curseur au clic.")
      .addToggle((t) =>
        t.setValue(S.liveHyphenation).onChange(async (v) => {
          S.liveHyphenation = v;
          await this.plugin.saveSettings();
          this.plugin.applyLiveTypoClasses();
        })
      );

    new Setting(containerEl)
      .setName("Live Preview : texte justifié")
      .setDesc(
        "Justification seule, SANS césure (la césure en Live Preview fait ramer le défilement). Si le curseur se place mal au clic, désactive : c'est la justification qui perturbe le calcul de position de CodeMirror."
      )
      .addToggle((t) =>
        t.setValue(S.liveJustify).onChange(async (v) => {
          S.liveJustify = v;
          await this.plugin.saveSettings();
          this.plugin.applyLiveTypoClasses();
        })
      );

    new Setting(containerEl)
      .setName("Mode lecture : même interligne qu'en Live Preview")
      .setDesc(
        "Aligne l'interligne et l'espacement des paragraphes du mode lecture sur ceux de l'éditeur."
      )
      .addToggle((t) =>
        t.setValue(S.readingMatchLive !== false).onChange(async (v) => {
          S.readingMatchLive = v;
          await this.plugin.saveSettings();
          this.plugin.applyLiveTypoClasses();
        })
      );

    new Setting(containerEl)
      .setName("Taille du texte en mode lecture")
      .setDesc(
        "Couvre le mode lecture natif d'Obsidian ET le mode Lecture du tableau/plan (Feuillets). Obsidian lie normalement cette taille à celle du Live Preview. 0 = taille par défaut d'Obsidian (partagée) ; toute autre valeur ne change que la lecture."
      )
      .addSlider((s) =>
        s
          .setLimits(0, 28, 1)
          .setValue(S.readingFontSize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.readingFontSize = v;
            await this.plugin.saveSettings();
            this.plugin.applyLiveTypoClasses();
          })
      );

    containerEl.createEl("h3", { text: "Mode concentration", attr: { "data-cat": "Écriture" } });

     new Setting(containerEl)
      .setName("Niveau de focus")
      .setDesc("Ligne (fiable) ou paragraphe entier autour du curseur.")
      .addDropdown((d) =>
        d
          .addOption("line", "Ligne")
          .addOption("paragraph", "Paragraphe")
          .setValue(S.concentrationUnit)
          .onChange(async (v) => {
            S.concentrationUnit = v;
            await this.plugin.saveSettings();
          })
      );

     new Setting(containerEl)
      .setName("Défilement machine à écrire")
      .setDesc("La ligne du curseur reste verticalement centrée pendant la frappe.")
      .addToggle((t) =>
        t.setValue(S.concentrationTypewriter).onChange(async (v) => {
          S.concentrationTypewriter = v;
          await this.plugin.saveSettings();
        })
      );

     new Setting(containerEl)
      .setName("Compteur de mots flottant")
      .setDesc("Mots / objectif du feuillet actif, en bas à droite (vert à l'objectif, rouge au-delà).")
      .addToggle((t) =>
        t.setValue(S.concentrationCounter).onChange(async (v) => {
          S.concentrationCounter = v;
          await this.plugin.saveSettings();
          if (!v) this.plugin.removeConcentrationCounter();
        })
      );

     new Setting(containerEl)
      .setName("Niveau d'estompage (%)")
      .addSlider((sl) =>
        sl
          .setLimits(10, 80, 5)
          .setValue(S.dimOpacity)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.dimOpacity = v;
            await this.plugin.saveSettings();
            document.body.style.setProperty(
               "--feuillets-dim-opacity",
              `${v / 100}`
            );
          })
      );

     new Setting(containerEl)
      .setName("Largeur maximale du texte (px)")
      .addSlider((sl) =>
        sl
          .setLimits(480, 1000, 20)
          .setValue(S.concentrationWidth)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.concentrationWidth = v;
            await this.plugin.saveSettings();
            document.body.style.setProperty(
               "--feuillets-concentration-width",
              `${v}px`
            );
          })
      );

    containerEl.createEl("h3", { text: "Numérotation", attr: { "data-cat": "Projet" } });

    new Setting(containerEl)
      .setName("Rôle des dossiers de premier niveau")
      .setDesc("Détermine le vocabulaire utilisé par la numérotation ci-dessous.")
      .addDropdown((d) =>
        d
          .addOption("parties", "Parties")
          .addOption("chapitres", `Chapitres (fichiers = ${unitPlural})`)
          .setValue(S.level1Role)
          .onChange(async (v) => {
            S.level1Role = v;
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(containerEl)
      .setName("Numérotation des chapitres")
      .setDesc(
        "Continue (1..n sur tout le manuscrit), redémarrant à 1 à chaque partie, ou aucune. La renumérotation automatique des titres suit le même mode."
      )
      .addDropdown((d) =>
        d
          .addOption("continu", "continue (1..n globale)")
          .addOption("parPartie", "par partie (recommence à 1)")
          .addOption("aucune", "aucune")
          .setValue(S.chapterNumbering)
          .onChange(async (v) => {
            S.chapterNumbering = v;
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(containerEl)
      .setName(`Numérotation des ${unitPlural}`)
      .setDesc(
        "Les chapitres sont toujours numérotés en continu (1..n) sur tout le manuscrit ; les parties ne comptent jamais."
      )
      .addDropdown((d) =>
        d
          .addOption("hier", `chapitre.${unit} (1.1, 1.2…)`)
          .addOption("continue", "continue (1, 2, 3… globale)")
          .addOption("aucune", "aucune")
          .setValue(S.sceneNumbering)
          .onChange(async (v) => {
            S.sceneNumbering = v;
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(containerEl)
      .setName("Renumérotation automatique des titres")
      .setDesc(
        "Met à jour la clé `titre` des chapitres-fichiers suivant « préfixe N ». Aucun fichier renommé."
      )
      .addToggle((t) =>
        t.setValue(S.autoRename).onChange(async (v) => {
          S.autoRename = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Préfixe de renumérotation").addText((t) =>
      t.setValue(S.renamePrefix).onChange(async (v) => {
        S.renamePrefix = v.trim() || "chapitre";
        await this.plugin.saveSettings();
      })
    );

    containerEl.createEl("h3", { text: "Fusion des scènes", attr: { "data-cat": "Écriture" } });

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      "Réglages par défaut de « Fusionner » (mode sélection du Tableau) et « Scinder » (menu du feuillet)."
    );

    new Setting(containerEl)
      .setName("Preset YAML par défaut")
      .setDesc("Roman, Nouvelle, Scénario ou Minimal")
      .addDropdown((drop) => {
        Object.entries(YAML_PRESETS).forEach(([key, item]) =>
          drop.addOption(key, item.label)
        );
        drop.setValue(S.mergeYamlPreset);
        drop.onChange(async (value) => {
          S.mergeYamlPreset = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Mode de fusion par défaut")
      .setDesc("Titre intermédiaire, commentaire ou texte continu")
      .addDropdown((drop) => {
        drop.addOption("heading", "Titre intermédiaire");
        drop.addOption("comment", "Commentaire de provenance");
        drop.addOption("continuous", "Texte continu");
        drop.setValue(S.mergeModeDefault);
        drop.onChange(async (value) => {
          S.mergeModeDefault = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Conserver le séparateur")
      .addToggle((toggle) => {
        toggle.setValue(S.mergeKeepSeparatorDefault);
        toggle.onChange(async (value) => {
          S.mergeKeepSeparatorDefault = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Séparateur de fusion")
      .setDesc("Ligne insérée entre les blocs fusionnés")
      .addTextArea((area) => {
        area.setValue(S.mergeNotesSeparator);
        area.inputEl.rows = 3;
        area.inputEl.style.width = "100%";
        area.onChange(async (value) => {
          S.mergeNotesSeparator = value;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl("h3", { text: "Panneau Cartes", attr: { "data-cat": "Tableau" } });

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      `Couvre les 5 modes du panneau (Cartes, Plan, Chemin de fer, Chronologie, Lecture). Les réglages ci-dessous concernent surtout les cartes du mode Cartes.`
    );

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      `Mode Chemin de fer : lit \`label\` et \`fil\` (liste, valeur unique, ou séparée par des virgules) dans le frontmatter de chaque ${unit} — aucun réglage à faire ici, juste les renseigner dans le YAML. Un fil vu pour la première fois est recopié automatiquement dans le dernier feuillet du projet (marqueur en attente) ; il est retiré automatiquement dès que ce même fil apparaît ailleurs (résolution).`
    );

    new Setting(containerEl)
      .setName("Taille des tuiles (px)")
      .setDesc("Largeur minimale d'une carte quand les colonnes sont automatiques.")
      .addSlider((s) =>
        s
          .setLimits(160, 420, 10)
          .setValue(S.tileSize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.tileSize = v;
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
          })
      );

    new Setting(containerEl)
      .setName("Nombre de colonnes")
      .setDesc("0 = automatique selon la taille des tuiles (sinon la taille des tuiles n'a plus d'effet visuel).")
      .addSlider((s) =>
        s
          .setLimits(0, 8, 1)
          .setValue(S.columns)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.columns = v;
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
          })
      );

    new Setting(containerEl)
      .setName("Contenu des tuiles")
      .setDesc("Extrait : premières lignes du texte (façon Ulysses). Synopsis : champ éditable.")
      .addDropdown((d) =>
        d
          .addOption("extrait", "Extrait du texte")
          .addOption("synopsis", "Synopsis éditable")
          .setValue(S.cardContent)
          .onChange(async (v) => {
            S.cardContent = v;
            await this.plugin.saveSettings();
            refresh();
          })
      );

    new Setting(containerEl)
      .setName("Afficher les tags sur les tuiles")
      .setDesc("Dans le plan, la colonne Tags se gère via le bouton « Colonnes ».")
      .addToggle((t) =>
        t.setValue(S.showCardTags).onChange(async (v) => {
          S.showCardTags = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName("Longueur de l'extrait sur les tuiles (caractères)")
      .addText((t) =>
        t.setValue(String(S.excerptLength)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.excerptLength = isNaN(n) ? 420 : Math.max(80, n);
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName("Tableau : anneaux de progression")
      .setDesc("Le binder a son propre réglage dans la section Binder.")
      .addToggle((t) =>
        t.setValue(S.showProgress).onChange(async (v) => {
          S.showProgress = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    containerEl.createEl("h3", { text: "Panneaux au démarrage", attr: { "data-cat": "Panneaux latéraux" } });

    new Setting(containerEl)
      .setName("Ouvrir automatiquement le binder")
      .setDesc("Au démarrage d'Obsidian, dans la barre latérale gauche.")
      .addToggle((t) =>
        t.setValue(S.autoOpenBinder).onChange(async (v) => {
          S.autoOpenBinder = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ouvrir automatiquement le panneau Recherche")
      .setDesc("Au démarrage d'Obsidian, dans la barre latérale droite.")
      .addToggle((t) =>
        t.setValue(S.autoOpenResearch).onChange(async (v) => {
          S.autoOpenResearch = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ouvrir automatiquement le panneau Notes")
      .setDesc("Au démarrage d'Obsidian, dans la barre latérale droite.")
      .addToggle((t) =>
        t.setValue(S.autoOpenNotes).onChange(async (v) => {
          S.autoOpenNotes = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ouvrir automatiquement le panneau Journal & statistiques")
      .setDesc("Au démarrage d'Obsidian, dans la barre latérale droite.")
      .addToggle((t) =>
        t.setValue(S.autoOpenJournal).onChange(async (v) => {
          S.autoOpenJournal = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ouvrir automatiquement le panneau Projet & export")
      .setDesc("Au démarrage d'Obsidian, dans la barre latérale droite.")
      .addToggle((t) =>
        t.setValue(S.autoOpenProject).onChange(async (v) => {
          S.autoOpenProject = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ouvrir automatiquement le panneau Propriétés")
      .setDesc("Au démarrage d'Obsidian, dans la barre latérale droite.")
      .addToggle((t) =>
        t.setValue(S.autoOpenProperties).onChange(async (v) => {
          S.autoOpenProperties = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ouvrir automatiquement le panneau Révision")
      .setDesc("Au démarrage d'Obsidian, dans la barre latérale droite — retours .docx d'un directeur/éditeur.")
      .addToggle((t) =>
        t.setValue(S.autoOpenDocxReview).onChange(async (v) => {
          S.autoOpenDocxReview = v;
          await this.plugin.saveSettings();
        })
      );


    containerEl.createEl("h3", { text: "Vues actives", attr: { "data-cat": "Panneaux latéraux" } });

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      "Masque les vues que tu n'utilises pas, pour alléger l'interface — sans rien supprimer, tu peux les réactiver à tout moment."
    );

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      "Modes du panneau Cartes :"
    );
    const meta = root ? S.projectMeta[root.path] : null;
    const projectHiddenModes = meta ? (meta.hiddenBoardModes || S.hiddenBoardModes || []) : (S.hiddenBoardModes || []);
    const hiddenModes = new Set(projectHiddenModes);
    for (const [key, defaultLabel] of BOARD_MODES) {
      const label = key === "arcs" ? "Chemin de fer" : defaultLabel;
      new Setting(containerEl).setName(label).addToggle((t) =>
        t.setValue(!hiddenModes.has(key)).onChange(async (v) => {
          const set = new Set(projectHiddenModes);
          if (v) set.delete(key);
          else set.add(key);
          const newHidden = [...set];
          if (meta) {
            meta.hiddenBoardModes = newHidden;
          }
          S.hiddenBoardModes = newHidden;
          await this.plugin.saveSettings();
          this.plugin.renderAllViews(true);
        })
      );
    }

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      "Panneaux latéraux (icône du ruban et commande retirées si masqué) :"
    );
    const hiddenPanels = new Set(S.hiddenPanels || []);
    for (const { key, label } of HIDEABLE_PANELS) {
      new Setting(containerEl).setName(label).addToggle((t) =>
        t.setValue(!hiddenPanels.has(key)).onChange(async (v) => {
          if (!v) {
            await this.plugin.hidePanel(key);
            return;
          }
          const set = new Set(S.hiddenPanels || []);
          set.delete(key);
          S.hiddenPanels = [...set];
          await this.plugin.saveSettings();
          this.plugin.refreshRibbonIcons();
        })
      );
    }

    containerEl.createEl("h3", { text: "Binder", attr: { "data-cat": "Panneaux latéraux" } });

     new Setting(containerEl)
      .setName("Liserés de couleur des labels")
      .addToggle((t) =>
        t.setValue(S.binderShowLabels).onChange(async (v) => {
          S.binderShowLabels = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(containerEl)
      .setName("Pastilles de tags")
      .addToggle((t) =>
        t.setValue(S.binderShowTags).onChange(async (v) => {
          S.binderShowTags = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(containerEl)
      .setName("Pastille de statut")
      .addToggle((t) =>
        t.setValue(S.binderShowStatus).onChange(async (v) => {
          S.binderShowStatus = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(containerEl)
      .setName("Barres de progression")
      .addToggle((t) =>
        t.setValue(S.binderShowProgress).onChange(async (v) => {
          S.binderShowProgress = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(containerEl)
      .setName("Nombre de mots en chiffres")
      .addToggle((t) =>
        t.setValue(S.binderShowWords).onChange(async (v) => {
          S.binderShowWords = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

     new Setting(containerEl)
      .setName("Aperçu de la fiche")
      .setDesc("Champ affiché sous le titre de chaque feuillet, en lecture seule.")
      .addDropdown((d) =>
        d
          .addOption("none", "Aucun")
          .addOption("extrait", "Extrait du texte")
          .addOption("synopsis", "Synopsis")
          .addOption("summary", "Résumé long")
          .addOption("notes", "Notes de travail")
          .addOption("tags", "Tags")
          .setValue(S.listPanePreviewField)
          .onChange(async (v) => {
            S.listPanePreviewField = v;
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
          })
      );

     new Setting(containerEl)
      .setName("Nombre de lignes de l'aperçu")
      .addSlider((s) =>
        s
          .setLimits(1, 6, 1)
          .setValue(S.listPanePreviewLines)
          .setDynamicTooltip()
          .onChange(async (v) => {
            S.listPanePreviewLines = v;
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
          })
      );

     new Setting(containerEl)
      .setName("Sous-dossiers inclus dans le double volet")
      .setDesc("Affiche récursivement dans le volet de droite les fichiers des sous-dossiers du dossier sélectionné.")
      .addToggle((t) =>
        t
          .setValue(S.binderSplitRecursive !== false)
          .onChange(async (v) => {
            S.binderSplitRecursive = v;
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
          })
      );

     new Setting(containerEl)
      .setName("Gestes de balayage (trackpad / tactile)")
      .setDesc("Ouvrir/fermer les volets latéraux par balayage horizontal près des bords. À désactiver si un autre plugin (ex. un navigateur de fichiers alternatif) intercepte aussi ces gestes.")
      .addToggle((t) =>
        t.setValue(S.swipeGesturesEnabled !== false).onChange(async (v) => {
          S.swipeGesturesEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "Panneau Notes", attr: { "data-cat": "Panneaux latéraux" } });

    new Setting(containerEl)
      .setName("Afficher les entités citées")
      .setDesc(
        (() => {
          /* Les rubriques disponibles varient selon le mode (voir
             utils/project-modes.js — personnages/lieux/codex/glossaire
             n'existent pas en non-fiction) : construit l'exemple à partir
             de ce qui existe réellement plutôt que de suppposer une
             liste fixe. */
          const rf = mode.researchFolders;
          const examples = [rf.personnages, rf.lieux, rf.sources, rf.codex]
            .filter(Boolean)
            .map((r) => r.label.toLowerCase());
          const list = examples.length ? `${examples.join(", ")}…` : "fiches de recherche";
          return `Affiche les fiches de recherche citées (${list}) dans le corps de la ${unit}.`;
        })()
      )
      .addToggle((t) =>
        t.setValue(S.notesShowEntities).onChange(async (v) => {
          S.notesShowEntities = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName("Afficher les notes de bas de page")
      .setDesc(`Liste les notes de bas de page ("[^1]: …") définies dans le corps de la ${unit}.`)
      .addToggle((t) =>
        t.setValue(S.notesShowFootnotes).onChange(async (v) => {
          S.notesShowFootnotes = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName("Afficher le synopsis")
      .addToggle((t) =>
        t.setValue(S.notesShowSynopsis).onChange(async (v) => {
          S.notesShowSynopsis = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName("Afficher le résumé")
      .addToggle((t) =>
        t.setValue(S.notesShowResume).onChange(async (v) => {
          S.notesShowResume = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName("Afficher les notes de travail")
      .addToggle((t) =>
        t.setValue(S.notesShowNotes).onChange(async (v) => {
          S.notesShowNotes = v;
          await this.plugin.saveSettings();
          refresh();
        })
      );

    new Setting(containerEl)
      .setName("Ordre des rubriques (Notes)")
      .setDesc("Modifie l'ordre d'affichage des rubriques du panneau Notes.");

    const orderWrapNotes = containerEl.createDiv({ cls: "feuillets-notes-order-wrap" });
    this.renderSectionOrderList(orderWrapNotes, S, "notesSectionOrder", ["Synopsis", "Résumé", "Notes"], refresh);

    containerEl.createEl("h3", { text: "Correction grammaticale", attr: { "data-cat": "Panneaux latéraux" } });
    new Setting(containerEl)
      .setName("Détecter les répétitions de mots proches")
      .setDesc("Signale les mots répétés dans un même paragraphe ou une même phrase (désactivé par défaut dans Grammalecte lui-même — plus bruyant que les autres règles).")
      .addToggle((t) =>
        t.setValue(!!S.grammalecteDetectRepetitions).onChange(async (v) => {
          S.grammalecteDetectRepetitions = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Mots appris")
      .setDesc("Mots que tu as marqués « ne plus signaler » depuis l'onglet Correction grammaticale (vocabulaire absent du dictionnaire : noms propres, mots étrangers...).");
    const knownWordsWrap = containerEl.createDiv({ cls: "feuillets-tags" });
    this.renderKnownWordsList(knownWordsWrap, S);

    new Setting(containerEl)
      .setName("Fautes de grammaire ignorées")
      .setDesc("Signalements marqués « Ignorer » depuis l'onglet Correction grammaticale — une règle précise sur un mot précis, pas tout un type de faute.");
    const ignoredRulesWrap = containerEl.createDiv({ cls: "feuillets-tags" });
    this.renderIgnoredRulesList(ignoredRulesWrap, S);

    containerEl.createEl("h3", { text: "Compilation", attr: { "data-cat": "Export" } });

    new Setting(containerEl)
      .setName("Nom du fichier compilé")
      .setDesc("Écrit dans un dossier « Sortie », créé à côté du dossier projet — jamais mêlé au manuscrit lui-même.")
      .addText((t) =>
        t.setValue(S.compileFileName).onChange(async (v) => {
          S.compileFileName = v.trim() || "Manuscrit.md";
          await this.plugin.saveSettings();
        })
    );

    new Setting(containerEl)
      .setName("Insérer les titres des parties")
      .addToggle((t) =>
        t.setValue(S.insertFolderTitles).onChange(async (v) => {
          S.insertFolderTitles = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Insérer les titres des chapitres")
      .setDesc(
        "Dossiers-chapitres : leur nom. Chapitres-fichiers : la clé `titre` uniquement — jamais le nom du fichier."
      )
      .addToggle((t) =>
        t.setValue(S.insertTitles).onChange(async (v) => {
          S.insertTitles = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(`Insérer les titres des ${unitPlural}`)
      .setDesc(`Clé \`titre\` uniquement — les ${unitPlural} sans titre s'enchaînent.`)
      .addToggle((t) =>
        t.setValue(S.insertSceneTitles).onChange(async (v) => {
          S.insertSceneTitles = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Titre du manuscrit (page de titre .docx)")
      .setDesc("Vide : nom du dossier projet.")
      .addText((t) =>
        t.setValue(S.manuscriptTitle).onChange(async (v) => {
          S.manuscriptTitle = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Auteur (page de titre .docx)")
      .addText((t) =>
        t.setValue(S.manuscriptAuthor).onChange(async (v) => {
          S.manuscriptAuthor = v.trim();
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "Presets de compilation", attr: { "data-cat": "Export" } });

    (S.compilePresets || []).forEach((p, i) => {
      // Une carte par preset, une ligne étiquetée par champ : l'ancienne
      // version tassait nom + fichier + 3 interrupteurs sans libellé (juste
      // une infobulle au survol) sur une seule ligne — illisible sans
      // deviner ce que chaque interrupteur faisait.
      const card = containerEl.createDiv({ cls: "feuillets-merge-card" });
      const cardHead = card.createDiv({ cls: "feuillets-preset-card-head" });
      cardHead.createSpan({ cls: "feuillets-merge-card-title", text: p.name || `Preset ${i + 1}` });
      const delBtn = cardHead.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Supprimer ce preset" } });
      delBtn.setText("✕");
      delBtn.addEventListener("click", async () => {
        S.compilePresets.splice(i, 1);
        if (S.activePreset >= S.compilePresets.length) S.activePreset = -1;
        await this.plugin.saveSettings();
        this.display();
        refresh();
      });

      new Setting(card)
        .setName("Nom du preset")
        .addText((t) =>
          t.setValue(p.name || "").onChange(async (v) => {
            p.name = v.trim();
            await this.plugin.saveSettings();
          })
        );
      new Setting(card)
        .setName("Fichier de sortie")
        .addText((t) =>
          t.setPlaceholder("Sortie.md").setValue(p.fileName || "").onChange(async (v) => {
            p.fileName = v.trim();
            await this.plugin.saveSettings();
          })
        );
      new Setting(card)
        .setName("Insérer les titres de parties")
        .addToggle((t) =>
          t.setValue(p.folderTitles !== false).onChange(async (v) => {
            p.folderTitles = v;
            await this.plugin.saveSettings();
          })
        );
      new Setting(card)
        .setName("Insérer les titres de chapitres")
        .addToggle((t) =>
          t.setValue(p.chapterTitles !== false).onChange(async (v) => {
            p.chapterTitles = v;
            await this.plugin.saveSettings();
          })
        );
      new Setting(card)
        .setName(`Insérer les titres des ${unitPlural}`)
        .addToggle((t) =>
          t.setValue(p.sceneTitles === true).onChange(async (v) => {
            p.sceneTitles = v;
            await this.plugin.saveSettings();
          })
        );
    });

    new Setting(containerEl).addButton((b) =>
      b.setButtonText("Ajouter un preset").onClick(async () => {
        S.compilePresets.push({
          name: `Preset ${S.compilePresets.length + 1}`,
          fileName: "Sortie.md",
          folderTitles: true,
          chapterTitles: true,
          sceneTitles: false,
        });
        await this.plugin.saveSettings();
        this.display();
        refresh();
      })
    );

    containerEl.createEl("h3", { text: "Export", attr: { "data-cat": "Export" } });

    containerEl.createDiv({ cls: "setting-item-description" }).setText(
      "Moteur natif (par défaut) : aucune dépendance externe, fonctionne sur mobile aussi bien que sur bureau. Pandoc reste disponible en option pour qui l'a déjà installé et configuré — meilleure qualité typographique, mais bureau uniquement."
    );

    new Setting(containerEl)
      .setName("Moteur d'export")
      .setDesc("Natif : intégré, marche partout. Pandoc : programme externe à installer, bureau uniquement.")
      .addDropdown((drop) => {
        drop.addOption("natif", "Natif (par défaut)");
        drop.addOption("pandoc", "Pandoc (avancé)");
        drop.setValue(S.exportEngine || "natif");
        drop.onChange(async (value) => {
          S.exportEngine = value;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createDiv({ cls: "setting-item-description" }).setText(
      "Le choix du modèle de mise en page (Classique, Roman, APA…) se fait directement dans le menu « Compiler et exporter », pas ici — tu peux aussi ajouter tes propres modèles en déposant un fichier .md dans Resources/Layouts."
    );

    new Setting(containerEl)
      .setName("Typographie française à l'export")
      .setDesc("Guillemets droits → « », apostrophe → ’, ... → …, espaces insécables avant ; : ! ? — appliqué au texte compilé (jamais au fichier source), même si la typographie à la frappe est désactivée. Le code (``` ou `inline`) n'est jamais modifié. À désactiver si l'apostrophe/le guillemet droit a un sens technique dans ton projet.")
      .addToggle((t) =>
        t.setValue(S.exportFrenchTypography !== false).onChange(async (v) => {
          S.exportFrenchTypography = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      "— Export PDF uniquement (moteur natif, bureau) —"
    );

    new Setting(containerEl)
      .setName("En-tête gauche")
      .setDesc("Texte affiché en haut à gauche des pages (variables {title}, {author}).")
      .addText((t) =>
        t.setValue(S.pdfHeaderLeft || "{title}").onChange(async (v) => {
          S.pdfHeaderLeft = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("En-tête droit")
      .setDesc("Texte affiché en haut à droite des pages.")
      .addText((t) =>
        t.setValue(S.pdfHeaderRight || "{author}").onChange(async (v) => {
          S.pdfHeaderRight = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("En-têtes alternés (Pages paires / impaires)")
      .setDesc("Alterne l'en-tête gauche et l'en-tête droit selon la page.")
      .addToggle((t) =>
        t.setValue(!!S.pdfDiffHeaders).onChange(async (v) => {
          S.pdfDiffHeaders = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Masquer les en-têtes sur la première page")
      .addToggle((t) =>
        t.setValue(S.pdfHideFirstPageHeader ?? true).onChange(async (v) => {
          S.pdfHideFirstPageHeader = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Position du numéro de page")
      .addDropdown((d) =>
        d
          .addOption("right", "Droite")
          .addOption("center", "Centré")
          .addOption("left", "Gauche")
          .setValue(S.pdfPageNumberPosition || "right")
          .onChange(async (v) => {
            S.pdfPageNumberPosition = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Format du numéro de page")
      .setDesc("Modèle de numérotation ({page} et {pages}).")
      .addText((t) =>
        t.setValue(S.pdfFooterRight || "Page {page} sur {pages}").onChange(async (v) => {
          S.pdfFooterRight = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Format du papier")
      .addDropdown((d) =>
        d
          .addOption("A4", "A4 (210x297 mm)")
          .addOption("letter", "US Letter")
          .addOption("A5", "A5 (148x210 mm)")
          .addOption("poche", "Poche (110x180 mm)")
          .setValue(S.pdfPageSize || "A4")
          .onChange(async (v) => {
            S.pdfPageSize = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Marge Haut / Bas (cm)")
      .addText((t) =>
        t.setValue(String(S.pdfMarginTop ?? 2.5)).onChange(async (v) => {
          S.pdfMarginTop = parseFloat(v) || 2.5;
          S.pdfMarginBottom = parseFloat(v) || 2.5;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Marge Reliure (cm)")
      .addText((t) =>
        t.setValue(String(S.pdfMarginLeft ?? 2.5)).onChange(async (v) => {
          S.pdfMarginLeft = parseFloat(v) || 2.5;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Marges miroir (pages paires/impaires)")
      .addToggle((t) =>
        t.setValue(!!S.pdfMirrorMargins).onChange(async (v) => {
          S.pdfMirrorMargins = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      "— Export EPUB uniquement —"
    );

    new Setting(containerEl)
      .setName("Langue de l'EPUB")
      .setDesc("Code BCP 47, ex. fr, en, tr.")
      .addText((t) =>
        t.setValue(S.epubLanguage).onChange(async (v) => {
          S.epubLanguage = v.trim() || "fr";
          await this.plugin.saveSettings();
        })
      );

    containerEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      "— Moteur Pandoc uniquement (avancé) —"
    );

    new Setting(containerEl)
      .setName("Document de référence Pandoc")
      .setDesc(
        "Chemin dans le coffre du .docx de référence (styles, marges, numéros de page). Le fichier reference-feuillets.docx est fourni avec le plugin : copie-le à la racine du coffre."
      )
      .addText((t) =>
        t.setValue(S.pandocReference).onChange(async (v) => {
          S.pandocReference = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Chemin de Pandoc")
      .setDesc("Laisser « pandoc » si dans le PATH.")
      .addText((t) =>
        t.setValue(S.pandocPath).onChange(async (v) => {
          S.pandocPath = v.trim() || "pandoc";
          await this.plugin.saveSettings();
        })
      );

    this.organizeSections(containerEl);
  }

  /** Regroupe les réglages en quatre catégories, affichées en onglets
   * (Projet & Écriture, Tableau, Panneaux latéraux, Export) — un seul
   * onglet visible à la fois, plutôt qu'une longue page à défiler. À
   * l'intérieur de chaque onglet, chaque sous-section (Dossier du
   * projet, Objectifs...) garde son propre repli. Tout ça par
   * post-traitement du DOM : les réglages sont créés normalement, puis
   * déplacés — aucun risque sur leur logique. Pas de cinquième onglet
   * "Avancé" masqué par défaut : ça cachait des réglages courants
   * (taille de police, labels…) qu'un utilisateur avait de vraies
   * raisons de chercher — tout est maintenant rangé par sujet et
   * toujours visible, quitte à replier la sous-section elle-même. */
  organizeSections(containerEl) {
    const ORDER = ["Projet", "Écriture", "Tableau", "Panneaux latéraux", "Export"];

    // Passe 1 : regrouper les nœuds par catégorie puis par sous-section,
    // sans encore toucher au DOM (facile à corriger si une catégorie ne
    // correspond à aucun texte de h3 connu).
    const byCategory = {};
    for (const name of ORDER) byCategory[name] = [];
    let currentCategory = "Projet"; // tout ce qui précède le premier h3
    let currentSub = null;
    const nodes = Array.from(containerEl.children);
    for (const node of nodes) {
      if (node.tagName === "H2") continue; // titre principal reste en tête
      if (node.tagName === "H3") {
        /* La catégorie vit sur le h3 lui-même (attr data-cat, posé à la
           création — voir les containerEl.createEl("h3", ...) plus haut) :
           plus de dictionnaire séparé à tenir synchronisé avec les titres.
           Un h3 sans data-cat (oubli) tombe dans un onglet toujours
           visible plutôt que d'être caché en silence. */
        const cat = node.getAttr("data-cat");
        if (!cat || !ORDER.includes(cat)) {
          console.warn(`Feuillets : section de réglages "${node.textContent}" sans data-cat valide — ajoutée à "Projet" par défaut.`);
        }
        currentCategory = (cat && ORDER.includes(cat)) ? cat : "Projet";
        currentSub = { title: node.textContent, nodes: [] };
        byCategory[currentCategory].push(currentSub);
        node.remove(); // son texte devient le résumé du repli imbriqué
        continue;
      }
      if (currentSub) currentSub.nodes.push(node);
      else byCategory[currentCategory].push({ title: null, nodes: [node] });
    }

    if (!ORDER.includes(this._activeSettingsTab)) {
      this._activeSettingsTab = ORDER[0];
    }

    // Passe 2 : barre d'onglets.
    const tabBar = containerEl.createDiv({ cls: "feuillets-settings-tabs" });
    for (const name of ORDER) {
      const btn = tabBar.createEl("button", {
        cls: "feuillets-settings-tab-btn",
        text: name,
      });
      if (name === this._activeSettingsTab) btn.addClass("is-active");
      btn.addEventListener("click", () => {
        if (this._activeSettingsTab === name) return;
        this._activeSettingsTab = name;
        this.display();
      });
    }

    // Passe 3 : un panneau par catégorie (tous construits, un seul visible
    // à la fois) — les sous-sections gardent leur propre repli à l'intérieur.
    for (const name of ORDER) {
      const panel = containerEl.createDiv({ cls: "feuillets-settings-panel" });
      if (name !== this._activeSettingsTab) panel.style.display = "none";

      for (const sub of byCategory[name]) {
        if (!sub.title) {
          for (const n of sub.nodes) panel.appendChild(n);
          continue;
        }
        const subDet = document.createElement("details");
        subDet.addClass("feuillets-settings-subsection");
        if (sub.title === "Dossier & Gestion des projets" || sub.title === "Sauvegarde") subDet.setAttr("open", "");
        const subSum = document.createElement("summary");
        subSum.setText(sub.title);
        subSum.addClass("feuillets-settings-subhead");
        subDet.appendChild(subSum);
        for (const n of sub.nodes) subDet.appendChild(n);
        panel.appendChild(subDet);
      }
    }
  }

  renderKnownWordsList(container, S) {
    container.empty();
    const words = S.grammalecteKnownWords || [];
    if (words.length === 0) {
      container.createSpan({ cls: "feuillets-notes-sub" }).setText("Aucun mot appris pour l'instant.");
      return;
    }
    for (const word of [...words].sort((a, b) => a.localeCompare(b, "fr"))) {
      const chip = container.createSpan({ cls: "feuillets-tag-chip" });
      chip.setText(word);
      chip.title = "Cliquer pour retirer (le mot sera de nouveau signalé s'il n'est pas dans le dictionnaire)";
      chip.addEventListener("click", async () => {
        S.grammalecteKnownWords = words.filter((w) => w !== word);
        await this.plugin.saveSettings();
        this.renderKnownWordsList(container, S);
      });
    }
  }

  renderIgnoredRulesList(container, S) {
    container.empty();
    const sigs = S.grammalecteIgnoredRules || [];
    if (sigs.length === 0) {
      container.createSpan({ cls: "feuillets-notes-sub" }).setText("Aucune faute ignorée pour l'instant.");
      return;
    }
    for (const sig of [...sigs].sort()) {
      const [ruleId, word] = sig.split("::");
      const chip = container.createSpan({ cls: "feuillets-tag-chip" });
      chip.setText(word ? `${word} (${ruleId})` : ruleId);
      chip.title = "Cliquer pour retirer (cette règle sera de nouveau signalée sur ce mot)";
      chip.addEventListener("click", async () => {
        S.grammalecteIgnoredRules = sigs.filter((s) => s !== sig);
        await this.plugin.saveSettings();
        this.renderIgnoredRulesList(container, S);
      });
    }
  }

  renderSectionOrderList(container, S, key, defaults, refresh) {
    container.empty();
    let order = S[key] || defaults;
    // Dédoublonner et ne garder que les valeurs présentes dans defaults
    order = Array.from(new Set(order)).filter(item => defaults.includes(item));
    // S'il manque des éléments de defaults, on les rajoute à la fin
    defaults.forEach(item => {
      if (!order.includes(item)) {
        order.push(item);
      }
    });
    S[key] = order;

    order.forEach((name, i) => {
      const row = container.createDiv({ cls: "feuillets-notes-order-wrap-row" });
      row.createSpan({ text: name });
      const btns = row.createDiv({ cls: "feuillets-notes-order-buttons" });

      const upBtn = btns.createEl("button", { text: "↑", cls: "clickable-icon" });
      upBtn.disabled = i === 0;
      upBtn.addEventListener("click", async () => {
        if (i === 0) return;
        [order[i - 1], order[i]] = [order[i], order[i - 1]];
        S[key] = order;
        await this.plugin.saveSettings();
        refresh();
        this.renderSectionOrderList(container, S, key, defaults, refresh);
      });

      const downBtn = btns.createEl("button", { text: "↓", cls: "clickable-icon" });
      downBtn.disabled = i === order.length - 1;
      downBtn.addEventListener("click", async () => {
        if (i === order.length - 1) return;
        [order[i + 1], order[i]] = [order[i], order[i + 1]];
        S[key] = order;
        await this.plugin.saveSettings();
        refresh();
        this.renderSectionOrderList(container, S, key, defaults, refresh);
      });
    });
  }
}
