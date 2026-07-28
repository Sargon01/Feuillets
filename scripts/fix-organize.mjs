import { readFileSync, writeFileSync } from 'fs';

const src = readFileSync('src/settings/feuillets-setting-tab.js', 'utf8');

const newMethod = `  organizeSections(containerEl) {
    const ORDER = ["Projet", "\\u00c9criture", "Interface", "Panneaux lat\\u00e9raux", "Correction", "Export"];
    const CATEGORY_LABELS = {
      "Projet": t("settings.category.project"),
      "\\u00c9criture": t("settings.category.writing"),
      "Interface": t("settings.category.interface"),
      "Panneaux lat\\u00e9raux": t("settings.category.sidePanels"),
      "Correction": t("settings.category.grammar"),
      "Export": t("settings.category.export"),
    };

    // --- Passe 1 : classification, sans toucher au DOM ---
    const byCategory = {};
    for (const name of ORDER) byCategory[name] = [];
    let currentCategory = "Projet";
    let currentSub = null;
    let header = null;

    for (const node of Array.from(containerEl.children)) {
      if (node.classList.contains("feuillets-settings-header")) {
        header = node; // conserv\\u00e9 s\\u00e9par\\u00e9ment, r\\u00e9ins\\u00e9r\\u00e9 apr\\u00e8s empty()
        continue;
      }
      if (node.classList.contains("feuillets-settings-section")) {
        /* La cat\\u00e9gorie est port\\u00e9e par l'attribut data-cat du marqueur,
           pos\\u00e9 \\u00e0 la cr\\u00e9ation. Un marqueur sans data-cat valide avertit
           en console et tombe dans "Projet" plutot que de disparaitre. */
        const cat = node.getAttr("data-cat");
        if (!cat || !ORDER.includes(cat)) {
          console.warn(\`Feuillets : section "\\${node.textContent}" sans data-cat valide \\u2014 Projet par d\\u00e9faut.\`);
        }
        currentCategory = (cat && ORDER.includes(cat)) ? cat : "Projet";
        /* data-open sur le marqueur plutot qu'une comparaison avec le titre
           traduit : la comparaison casserait silencieusement en anglais. */
        currentSub = {
          title: node.textContent,
          openByDefault: node.getAttr("data-open") === "1",
          nodes: [],
        };
        byCategory[currentCategory].push(currentSub);
        continue; // le marqueur lui-meme ne sera pas r\\u00e9ins\\u00e9r\\u00e9
      }
      if (currentSub) currentSub.nodes.push(node);
      else byCategory[currentCategory].push({ title: null, nodes: [node] });
    }

    if (!ORDER.includes(this._activeSettingsTab)) {
      this._activeSettingsTab = ORDER[0];
    }

    // --- Reconstruction : table rase puis r\\u00e9insertion ---
    // containerEl.empty() d\\u00e9tache tous les n\\u0153uds mais leurs r\\u00e9f\\u00e9rences JS
    // (stock\\u00e9es dans byCategory) restent valides : on peut les r\\u00e9appendre.
    containerEl.empty();
    if (header) containerEl.appendChild(header);

    // Passe 2 : barre d'onglets
    const tabBar = containerEl.createDiv({ cls: "feuillets-settings-tabs" });
    for (const name of ORDER) {
      const btn = tabBar.createEl("button", {
        cls: "feuillets-settings-tab-btn",
        text: CATEGORY_LABELS[name] || name,
      });
      if (name === this._activeSettingsTab) btn.addClass("is-active");
      btn.addEventListener("click", () => {
        if (this._activeSettingsTab === name) return;
        this._activeSettingsTab = name;
        this.display();
      });
    }

    // Passe 3 : panneaux
    // style.display plutot que toggleVisibility() : comportement garanti
    // identique dans toutes les versions d'Obsidian.
    for (const name of ORDER) {
      const panel = containerEl.createDiv({ cls: "feuillets-settings-panel" });
      if (name !== this._activeSettingsTab) panel.style.display = "none";

      for (const sub of byCategory[name]) {
        if (!sub.title) {
          for (const n of sub.nodes) panel.appendChild(n);
          continue;
        }
        // createEl() Obsidian plutot que document.createElement() :
        // garantit que les m\\u00e9thodes Obsidian sont disponibles sur l'\\u00e9l\\u00e9ment.
        const subDet = panel.createEl("details", { cls: "feuillets-settings-subsection" });
        if (sub.openByDefault) subDet.setAttribute("open", "");
        subDet.createEl("summary", { cls: "feuillets-settings-subhead", text: sub.title });
        for (const n of sub.nodes) subDet.appendChild(n);
      }
    }
  }`;

// Trouver et remplacer la méthode
const startMarker = '  organizeSections(containerEl) {';
const startIdx = src.indexOf(startMarker);
if (startIdx === -1) { console.error('Start marker not found'); process.exit(1); }

let braceCount = 0;
let i = startIdx + startMarker.length;
let methodEnd = -1;

for (; i < src.length; i++) {
  if (src[i] === '{') braceCount++;
  else if (src[i] === '}') {
    braceCount--;
    if (braceCount < 0) {
      methodEnd = i + 1;
      break;
    }
  }
}

if (methodEnd === -1) { console.error('Method end not found'); process.exit(1); }

const result = src.substring(0, startIdx) + newMethod + src.substring(methodEnd);
writeFileSync('src/settings/feuillets-setting-tab.js', result, 'utf8');
console.log('Done. Replaced', methodEnd - startIdx, 'chars with', newMethod.length, 'chars.');
