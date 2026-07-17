import { YAML_PRESETS } from "../scenes-editor.js";
import { BOARD_MODES, HIDEABLE_PANELS } from "../constants.js";
import { resolveType } from "../utils/project-modes.js";
const { PluginSettingTab, Setting } = require("obsidian");

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

    new Setting(containerEl)
      .setName("Réglages avancés")
      .setDesc(
        "Affiche les sections avancées : presets de compilation, historique, projets, Pandoc."
      )
      .addToggle((t) =>
        t.setValue(S.settingsAdvanced).onChange(async (v) => {
          S.settingsAdvanced = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    containerEl.createEl("h3", { text: "Dossier du projet" });

    new Setting(containerEl)
      .setName("Dossier projet")
      .setDesc(
        `Structure : parties (dossiers) → chapitres (sous-dossiers) → ${unitPlural} (fichiers). Niveaux 1 et 3 facultatifs. Ce dossier doit contenir directement tes parties/chapitres — pas un dossier parent qui contiendrait aussi Recherche ou Snapshots à côté.`
      )
      .addText((t) =>
        t
          .setPlaceholder("Projets/MonProjet")
          .setValue(S.projectFolder)
          .onChange(async (v) => {
            S.projectFolder = v.trim();
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
            this.plugin.updateStatusBar();
            refresh();
          })
      );

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
    }

    new Setting(containerEl)
      .setName("Rôle des dossiers de premier niveau")
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

    containerEl.createEl("h3", { text: "Objectifs" });

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
      .setDesc("0 pour ne pas afficher de barre de progression sur le total du projet, dans le panneau Statistiques.")
      .addText((t) =>
        t.setValue(String(S.projectWordGoal)).onChange(async (v) => {
          const n = parseInt(v, 10);
          S.projectWordGoal = isNaN(n) ? 0 : Math.max(0, n);
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

    containerEl.createEl("h3", { text: "Panneau Cartes" });

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

    containerEl.createEl("h3", { text: "Panneaux au démarrage" });

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
      .setName("Ouvrir automatiquement le panneau Progression")
      .setDesc("Au démarrage d'Obsidian, dans la barre latérale droite.")
      .addToggle((t) =>
        t.setValue(S.autoOpenStructure).onChange(async (v) => {
          S.autoOpenStructure = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ouvrir automatiquement le panneau Journal")
      .setDesc("Au démarrage d'Obsidian, dans la barre latérale droite.")
      .addToggle((t) =>
        t.setValue(S.autoOpenJournal).onChange(async (v) => {
          S.autoOpenJournal = v;
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

    containerEl.createEl("h3", { text: "Vues actives" });

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

    containerEl.createEl("h3", { text: "Binder" });

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
          .addOption("resume", "Résumé long")
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

    containerEl.createEl("h3", { text: "Apparence" });

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

    containerEl.createEl("h3", { text: "Typographie à la frappe" });

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
      .setName("Apostrophe typographique (' → \u2019)")
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
      .setName('Guillemets français (" → \u00AB \u00BB)')
      .setDesc("Contextuels : ouvrant en début de mot, fermant après un mot — avec espaces insécables.")
      .addToggle((t) =>
        t.setValue(S.liveGuillemets).onChange(async (v) => {
          S.liveGuillemets = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Tirets (-- → \u2013, --- → \u2014)")
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

    const currentMeta = root ? S.projectMeta[root.path] : null;
    const projectLabels = currentMeta && currentMeta.labels ? currentMeta.labels : S.labels;

    containerEl.createEl("h3", { text: root ? `Labels de couleur (Projet : ${root.name})` : "Labels de couleur" });

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

    containerEl.createEl("h3", { text: "Presets de compilation" });

    (S.compilePresets || []).forEach((p, i) => {
      const set = new Setting(containerEl)
        .setName(p.name || `Preset ${i + 1}`)
        .setDesc(`Nom · fichier de sortie · titres parties / chapitres / ${unitPlural}`);
      set.addText((t) =>
        t
          .setPlaceholder("Nom du preset")
          .setValue(p.name || "")
          .onChange(async (v) => {
            p.name = v.trim();
            await this.plugin.saveSettings();
          })
      );
      set.addText((t) =>
        t
          .setPlaceholder("Sortie.md")
          .setValue(p.fileName || "")
          .onChange(async (v) => {
            p.fileName = v.trim();
            await this.plugin.saveSettings();
          })
      );
      set.addToggle((t) =>
        t
          .setTooltip("Titres des parties")
          .setValue(p.folderTitles !== false)
          .onChange(async (v) => {
            p.folderTitles = v;
            await this.plugin.saveSettings();
          })
      );
      set.addToggle((t) =>
        t
          .setTooltip("Titres des chapitres")
          .setValue(p.chapterTitles !== false)
          .onChange(async (v) => {
            p.chapterTitles = v;
            await this.plugin.saveSettings();
          })
      );
      set.addToggle((t) =>
        t
          .setTooltip(`Titres des ${unitPlural}`)
          .setValue(p.sceneTitles === true)
          .onChange(async (v) => {
            p.sceneTitles = v;
            await this.plugin.saveSettings();
          })
      );
      set.addExtraButton((b) =>
        b
          .setIcon("trash")
          .setTooltip("Supprimer ce preset")
          .onClick(async () => {
            S.compilePresets.splice(i, 1);
            if (S.activePreset >= S.compilePresets.length) S.activePreset = -1;
            await this.plugin.saveSettings();
            this.display();
            refresh();
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

    containerEl.createEl("h3", { text: "Historique" });

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

    containerEl.createEl("h3", { text: "Mode concentration" });

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

    containerEl.createEl("h3", { text: "Numérotation" });

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

    containerEl.createEl("h3", { text: "Compilation" });

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

    containerEl.createEl("h3", { text: "Projets" });

    new Setting(containerEl)
      .setName("Créer un projet d'exemple")
      .setDesc(
        "Génère un projet Feuillets complet, avec du contenu réel dans chaque panneau (chemin de fer, fils narratifs, Recherche, Journal…), pour explorer toutes les fonctionnalités du plugin. N'affecte pas ton projet actif."
      )
      .addButton((b) =>
        b.setButtonText("Créer un projet d'exemple").onClick(async () => {
          await this.plugin.createDemoProject();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Autres projets")
      .setDesc(
        "Un chemin de dossier par ligne. Commande « Changer de projet… » pour basculer."
      )
      .addTextArea((t) =>
        t
          .setValue((S.projects || []).join("\n"))
          .onChange(async (v) => {
            S.projects = v
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Export" });

    containerEl.createDiv({ cls: "setting-item-description" }).setText(
      "L'export .docx/.epub appelle Pandoc, un programme installé localement sur ta machine (jamais un service en ligne). Aucune donnée n'est envoyée sur Internet. Bureau uniquement — indisponible sur mobile."
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

    new Setting(containerEl)
      .setName("Chemin de Pandoc")
      .setDesc("Pour l'export .docx. Laisser « pandoc » si dans le PATH.")
      .addText((t) =>
        t.setValue(S.pandocPath).onChange(async (v) => {
          S.pandocPath = v.trim() || "pandoc";
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "Édition des fiches" });

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

    containerEl.createEl("h3", { text: "Panneau Notes" });

    new Setting(containerEl)
      .setName("Afficher les entités citées")
      .setDesc(
        `Affiche les fiches de recherche citées (${mode.researchFolders.personnages.label.toLowerCase()}, ${mode.researchFolders.lieux.label.toLowerCase()}...) dans le corps de la ${unit}.`
      )
      .addToggle((t) =>
        t.setValue(S.notesShowEntities).onChange(async (v) => {
          S.notesShowEntities = v;
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




    this.organizeSections(containerEl);
  }

  /** Regroupe les réglages en cinq catégories pliables (Projet & Écriture,
   * Tableau, Panneaux latéraux, Export, Avancé), et à l'intérieur de
   * chacune, replie chaque sous-section (Dossier du projet, Objectifs...)
   * dans son propre repli — deux niveaux de pli au lieu d'une longue liste
   * de réglages à la suite. Tout ça par post-traitement du DOM : les
   * réglages sont créés normalement, puis déplacés — aucun risque sur
   * leur logique. En mode simple, la catégorie Avancé est masquée
   * entièrement. */
  organizeSections(containerEl) {
    const MAP = {
      "Dossier du projet": "Projet & Écriture",
      "Objectifs": "Projet & Écriture",
      "Numérotation": "Projet & Écriture",
      "Typographie à la frappe": "Projet & Écriture",
      "Mode concentration": "Projet & Écriture",
      "Édition des fiches": "Projet & Écriture",
      "Panneau Cartes": "Tableau",
      "Panneaux au démarrage": "Panneaux latéraux",
      "Vues actives": "Panneaux latéraux",
      "Binder": "Panneaux latéraux",
      "Apparence": "Avancé",
      "Panneau Notes": "Panneaux latéraux",
      "Compilation": "Export",
      "Export": "Export",
      "Labels de couleur": "Avancé",
      "Presets de compilation": "Avancé",
      "Historique": "Avancé",
      "Projets": "Avancé",
    };
    const ORDER = ["Projet & Écriture", "Tableau", "Panneaux latéraux", "Export", "Avancé"];

    // Passe 1 : regrouper les nœuds par catégorie puis par sous-section,
    // sans encore toucher au DOM (facile à corriger si une catégorie ne
    // correspond à aucun texte de h3 connu).
    const byCategory = {};
    for (const name of ORDER) byCategory[name] = [];
    let currentCategory = "Projet & Écriture"; // tout ce qui précède le premier h3
    let currentSub = null;
    const nodes = Array.from(containerEl.children);
    for (const node of nodes) {
      if (node.tagName === "H2") continue; // titre principal reste en tête
      if (
        node.tagName === "DIV" &&
        node.querySelector &&
        node.textContent.startsWith("Réglages avancés")
      )
        continue; // le toggle reste en tête
      if (node.tagName === "H3") {
        currentCategory = MAP[node.textContent] || "Avancé";
        currentSub = { title: node.textContent, nodes: [] };
        byCategory[currentCategory].push(currentSub);
        node.remove(); // son texte devient le résumé du repli imbriqué
        continue;
      }
      if (currentSub) currentSub.nodes.push(node);
      else byCategory[currentCategory].push({ title: null, nodes: [node] });
    }

    // Passe 2 : construire les replis (catégorie, puis sous-section) et
    // les réinsérer dans l'ordre.
    for (const name of ORDER) {
      if (name === "Avancé" && !this.plugin.settings.settingsAdvanced) continue;
      const det = document.createElement("details");
      det.addClass("feuillets-settings-section");
      if (name === "Projet & Écriture") det.setAttr("open", "");
      const sum = document.createElement("summary");
      sum.setText(name);
      det.appendChild(sum);

      for (const sub of byCategory[name]) {
        if (!sub.title) {
          for (const n of sub.nodes) det.appendChild(n);
          continue;
        }
        const subDet = document.createElement("details");
        subDet.addClass("feuillets-settings-subsection");
        if (sub.title === "Dossier du projet") subDet.setAttr("open", "");
        const subSum = document.createElement("summary");
        subSum.setText(sub.title);
        subSum.addClass("feuillets-settings-subhead");
        subDet.appendChild(subSum);
        for (const n of sub.nodes) subDet.appendChild(n);
        det.appendChild(subDet);
      }
      containerEl.appendChild(det);
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

/* ---------- plugin ---------- */

