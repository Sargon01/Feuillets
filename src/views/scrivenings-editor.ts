import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { t } from "../i18n/index.js";

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ScriveningsPlugin {
  shortTitleFor(file: TFile): string;
}

export class ScriveningsManager {
  app: App;
  containerEl: HTMLElement;
  onOpenFile: (file: TFile) => void;
  isSaving: boolean;

  constructor(app: App, containerEl: HTMLElement, onOpenFile: (file: TFile) => void) {
    this.app = app;
    this.containerEl = containerEl;
    this.onOpenFile = onOpenFile;
    this.isSaving = false;
  }

  async loadScenes(files: TFile[], plugin: ScriveningsPlugin, component: Component): Promise<void> {
    this.containerEl.empty();

    const wrapper = this.containerEl.createDiv({ cls: "feuillets-scrivenings-wrapper" });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const rawContent = await this.app.vault.read(file);

      // Extraction du YAML et du corps de texte
      const frontmatterMatch = rawContent.match(/^---\n[\s\S]*?\n---\n?/);
      const frontmatter = frontmatterMatch ? frontmatterMatch[0] : "";
      let body = rawContent.slice(frontmatter.length).trim();

      const shortTitle = plugin.shortTitleFor(file) || file.basename;

      // Bloc conteneur de la scène
      const sceneBlock = wrapper.createDiv({ cls: "feuillets-scrivenings-scene" });
      sceneBlock.setAttr("data-path", file.path);

      // En-tête de séparation visuelle
      const header = sceneBlock.createDiv({ cls: "feuillets-scrivenings-header" });
      header.createSpan({ cls: "feuillets-scrivenings-title", text: `📄 ${shortTitle}` })
        .setAttr("title", t("scrivenings.openInMainEditorTooltip"));
      header.addEventListener("click", () => this.onOpenFile(file));

      // Conteneur adoptant les classes de la vue Lecture native d'Obsidian
      const bodyContainer = sceneBlock.createDiv({
        cls: "feuillets-scrivenings-content markdown-rendered markdown-preview-view"
      });

      const renderScene = async () => {
        bodyContainer.empty();

        const renderEl = bodyContainer.createDiv({ cls: "feuillets-rendered-body" });
        renderEl.setAttr("title", t("scrivenings.doubleClickToEditTooltip"));

        // Rendu Markdown natif (génère <p>, <em>, <strong>, etc.)
        await MarkdownRenderer.render(this.app, body || t("scrivenings.emptyScene"), renderEl, file.path, component);

        // Double-clic pour passer en mode édition sur cette scène
        renderEl.addEventListener("dblclick", (evt) => {
          if ((evt.target as HTMLElement).tagName === "A") return;

          const scrollContainer = (this.containerEl.closest(".feuillets-board-scroll") as HTMLElement) || this.containerEl;
          const savedScroll = scrollContainer.scrollTop;

          // Capture la position du mot double-cliqué avant que le rendu ne soit détruit
          const clickedOffset = this.findRawOffsetOfSelection(renderEl, body);

          bodyContainer.empty();
          const area = bodyContainer.createEl("textarea", {
            cls: "feuillets-inline-editor feuillets-autosize",
            attr: { spellcheck: "true" }
          });
          area.value = body;

          const adjustHeight = () => {
            area.style.removeProperty("height");
            area.style.height = Math.max(120, area.scrollHeight) + "px";
          };

          adjustHeight();
          area.addEventListener("input", adjustHeight);
          area.focus({ preventScroll: true });
          if (clickedOffset !== null) {
            area.setSelectionRange(clickedOffset, clickedOffset);
            // La mise en page du textarea (police, largeur, syntaxe markdown visible)
            // diffère du rendu : on recalcule la position réelle du curseur au lieu
            // de restaurer l'ancien scroll, sans quoi le curseur tombe hors champ.
            const caretTop = this.measureCaretOffsetTop(area, clickedOffset);
            const areaRect = area.getBoundingClientRect();
            const containerRect = scrollContainer.getBoundingClientRect();
            scrollContainer.scrollTop +=
              (areaRect.top - containerRect.top) + caretTop - scrollContainer.clientHeight / 3;
          } else {
            scrollContainer.scrollTop = savedScroll;
          }

          // Enregistrement silencieux à la perte de focus et réapplication du rendu Markdown
          area.addEventListener("blur", () => {
            void (async () => {
              const currentScroll = scrollContainer.scrollTop;
              const newText = area.value.trim();
              if (newText !== body) {
                body = newText;
                this.isSaving = true;
                try {
                  await this.app.vault.modify(file, frontmatter + (frontmatter ? "\n" : "") + body + "\n");
                } finally {
                  window.setTimeout(() => { this.isSaving = false; }, 400);
                }
              }
              await renderScene();
              scrollContainer.scrollTop = currentScroll;
            })();
          });
        });
      };

      await renderScene();
    }
  }

  // Mesure la position verticale (en pixels, relative au textarea) qu'occupera
  // le curseur à l'offset donné, via un clone invisible du textarea (même police,
  // même largeur, même retour à la ligne) portant un marqueur à cet offset.
  measureCaretOffsetTop(textarea: HTMLTextAreaElement, offset: number): number {
    const style = getComputedStyle(textarea);
    const mirror = document.createElement("div");
    const propsToCopy: (keyof CSSStyleDeclaration)[] = [
      "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"
    ];
    propsToCopy.forEach((p) => { (mirror.style as any)[p] = style[p]; });
    Object.assign(mirror.style, {
      position: "absolute",
      visibility: "hidden",
      top: "0",
      left: "-9999px",
      height: "auto",
      whiteSpace: "pre-wrap",
      wordWrap: "break-word",
    });

    mirror.appendChild(document.createTextNode(textarea.value.slice(0, offset)));
    const marker = document.createElement("span");
    marker.textContent = "​";
    mirror.appendChild(marker);

    document.body.appendChild(mirror);
    const top = marker.offsetTop;
    document.body.removeChild(mirror);
    return top;
  }

  // Retrouve, dans le texte markdown brut, la position du mot que le double-clic
  // vient de sélectionner nativement dans le rendu HTML (dont la syntaxe markdown est absente).
  findRawOffsetOfSelection(renderEl: HTMLElement, rawBody: string): number | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const word = selection.toString().trim();
    if (!word) return null;

    const range = selection.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(renderEl);
    preRange.setEnd(range.startContainer, range.startOffset);
    const renderedTextBefore = preRange.toString();

    const wordRegex = new RegExp(escapeRegExp(word), "g");
    const occurrenceIndex = (renderedTextBefore.match(wordRegex) || []).length;

    wordRegex.lastIndex = 0;
    let match;
    let count = 0;
    while ((match = wordRegex.exec(rawBody)) !== null) {
      if (count === occurrenceIndex) return match.index;
      count++;
    }
    return null;
  }

  destroy(): void {
    this.containerEl.empty();
  }
}
