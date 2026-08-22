import { splitFrontmatter } from "./frontmatter.js";

export type PresentationLayout = "title" | "standard" | "media" | "media-text" | "gallery" | "quote" | "media-questions";
export type PresentationMediaQuestionsMode = "side" | "stacked";
export const PRESENTATION_DEFAULT_BODY_PX = 32;
export const PRESENTATION_MIN_BODY_PX = 18;
export const PRESENTATION_MEDIA_SCALES = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35] as const;

const SLIDE_SEPARATOR = /^\s*---\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** Découpe le corps Markdown en diapositives sans interpréter le Markdown. */
export function splitPresentationMarkdown(markdown: string): string[] {
  const { body } = splitFrontmatter(markdown);
  const slides: string[] = [];
  const current: string[] = [];
  let fence: "`" | "~" | null = null;

  const flush = () => {
    const slide = current.join("\n").trim();
    if (slide) slides.push(slide);
    current.length = 0;
  };

  for (const line of body.split(/\r?\n/)) {
    const match = line.match(FENCE);
    if (match) {
      const marker = match[1][0] as "`" | "~";
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      current.push(line);
      continue;
    }
    if (!fence && SLIDE_SEPARATOR.test(line)) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return slides;
}

export function presentationScale(availableWidth: number, availableHeight: number, baseWidth = 1280, baseHeight = 720): number {
  if (availableWidth <= 0 || availableHeight <= 0 || baseWidth <= 0 || baseHeight <= 0) return 0;
  return Math.min(1, availableWidth / baseWidth, availableHeight / baseHeight);
}

export function presentationOverflows(element: Pick<HTMLElement, "scrollWidth" | "clientWidth" | "scrollHeight" | "clientHeight">): boolean {
  return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
}

export function presentationBodySizeCandidates(defaultSize = PRESENTATION_DEFAULT_BODY_PX, minimum = PRESENTATION_MIN_BODY_PX): number[] {
  const candidates: number[] = [];
  for (let size = defaultSize - 1; size >= minimum; size--) candidates.push(size);
  return candidates;
}

export function presentationHeadingSize(level: 1 | 2 | 3 | 4, bodySize: number): number {
  const defaults = { 1: 64, 2: 52, 3: 42, 4: 36 } as const;
  const minimums = { 1: 38, 2: 34, 3: 30, 4: 26 } as const;
  return Math.max(minimums[level], Math.round(defaults[level] * bodySize / PRESENTATION_DEFAULT_BODY_PX));
}

function positiveSize(value: string | null): number | undefined {
  if (!value || !/^\d+(?:\.\d+)?(?:px)?$/.test(value.trim())) return undefined;
  const size = Number.parseFloat(value);
  return size > 0 ? size : undefined;
}

export function presentationExplicitMediaSize(image: HTMLImageElement): { width?: number; height?: number } | null {
  const wrapper = image.parentElement;
  const read = (name: "width" | "height") => positiveSize(image.getAttribute(name))
    ?? positiveSize(wrapper?.getAttribute(name) ?? null)
    ?? positiveSize(image.style[name])
    ?? positiveSize(wrapper?.style[name] ?? "");
  const width = read("width");
  const height = read("height");
  return width || height ? { ...(width ? { width } : {}), ...(height ? { height } : {}) } : null;
}

export function mediaQuestionsModeFor(mediaWidth: number, mediaHeight: number, listItemCount: number): PresentationMediaQuestionsMode {
  if (mediaWidth <= 0 || mediaHeight <= 0) return "stacked";
  const ratio = mediaWidth / mediaHeight;
  if (ratio <= 1.15) return listItemCount <= 6 ? "side" : "stacked";
  if (ratio < 1.45) return listItemCount <= 4 ? "side" : "stacked";
  return "stacked";
}

function directBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children) as HTMLElement[];
}

function isHeading(block: HTMLElement): boolean {
  return /^H[1-6]$/.test(block.tagName);
}

function isAutonomousMedia(block: HTMLElement): boolean {
  if (!/^(P|FIGURE|DIV)$/.test(block.tagName)) return false;
  if (block.querySelector("li, blockquote, table")) return false;
  const images = block.querySelectorAll("img, video, audio");
  if (images.length !== 1) return false;
  const textNodes = Array.from(block.childNodes).filter((node) => node.nodeType === 3 && node.textContent?.trim());
  return textNodes.length === 0;
}

export function presentationMediaBlocks(root: HTMLElement): HTMLElement[] {
  return directBlocks(root).filter(isAutonomousMedia);
}

/** Classe une slide uniquement à partir de sa structure DOM rendue. */
export function presentationLayoutFor(root: HTMLElement, index: number): PresentationLayout {
  const blocks = directBlocks(root);
  const media = presentationMediaBlocks(root);
  const headings = blocks.filter(isHeading);
  const nonHeading = blocks.filter((block) => !isHeading(block));
  const hasList = blocks.some((block) => block.tagName === "OL" || block.tagName === "UL");
  const hasTable = blocks.some((block) => block.tagName === "TABLE");
  const quotes = blocks.filter((block) => block.tagName === "BLOCKQUOTE");

  if (index === 0 && headings.some((block) => block.tagName === "H1" || block.tagName === "H2")
    && !media.length && !hasList && !hasTable && !quotes.length && nonHeading.every((block) => block.tagName === "P")) return "title";

  if (quotes.length === 1 && !media.length && !hasTable && nonHeading.every((block) => block.tagName === "BLOCKQUOTE" || block.tagName === "P")) return "quote";

  const nonMediaContent = nonHeading.filter((block) => !media.includes(block));
  if (media.length >= 2 && nonMediaContent.length === 0) return "gallery";
  const lists = nonMediaContent.filter((block) => block.tagName === "OL" || block.tagName === "UL");
  const context = nonMediaContent.filter((block) => !lists.includes(block));
  if (media.length === 1 && lists.length === 1 && context.length <= 2 && context.every((block) => block.tagName === "P")) return "media-questions";
  if (media.length === 1 && nonMediaContent.length === 0) return "media";
  if (media.length === 1 && nonMediaContent.length > 0) return "media-text";
  return "standard";
}
