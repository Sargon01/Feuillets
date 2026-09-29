import type { App, TFile } from "obsidian";
import { buildHeadingOutline, type HeadingOutlineInput, type HeadingOutlineNode } from "./heading-outline.js";

export function headingOutlineInputsForFile(app: App, file: TFile): HeadingOutlineInput[] {
  if (file.extension !== "md") return [];

  const cache = app.metadataCache.getFileCache(file);
  const headings = cache?.headings;
  if (!headings) return [];

  return headings.map((heading) => ({
    text: heading.heading,
    level: heading.level,
    startOffset: heading.position.start.offset,
    endOffset: heading.position.end.offset,
  }));
}

export function headingOutlineForFile(app: App, file: TFile): HeadingOutlineNode[] {
  return buildHeadingOutline(headingOutlineInputsForFile(app, file));
}
