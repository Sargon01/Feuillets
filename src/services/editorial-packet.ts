import { TFile, TFolder, type App } from "obsidian";
import { stripFrontmatter } from "./frontmatter.js";
import { editionRootPaths, getProjectFolder } from "./folder-structure.js";
import { EDITORIAL_EXPORTS_FOLDER, isEditorialSourceFolder } from "./editorial-document.js";
import { editionDocumentForName } from "./project-files.js";
import { createFileScope, createProjectScope, resolveCompileScopeFiles, type CompileScope } from "./compile-scope.js";
import { prepareNativeExport, resolveExportIdentity } from "./compile-export.js";
import { PACKET_HEADER_MIN_MARGIN_MM, PACKET_HEADER_TOP_MM, PACKET_HEADER_TYPE, preparePdfPrintDocument } from "./export-pdf.js";
import { exportDocx } from "./export-docx.js";
import { resolveExportTemplateV2 } from "./export-templates-custom.js";
import { exportFileName } from "./export-destination.js";
import type { CslCitationHost } from "./csl-citation-host.js";
import { t } from "../i18n/index.js";

export interface EditorialPacket {
  name: string;
  projectRoot: string;
  sources: string[];
  letterSource?: string;
  letterIndex?: number;
  format: "composite" | "pdf" | "docx";
  manuscript: "none" | "full" | "excerpt";
  excerpt?: string;
  manuscriptDocx: boolean;
  identity: boolean;
}

export interface PacketIdentity { author: string; title: string }

export interface PrintablePacketPart {
  html: string;
  css: string;
  lang: string;
  size: string;
  orientation: string;
  marginsMm?: [number, number, number, number];
}

export interface PacketLetter {
  recipient?: string;
  tracked?: true;
  print?(identity?: PacketIdentity): Promise<PrintablePacketPart>;
  docx?(identity?: PacketIdentity): Promise<ArrayBuffer>;
}

export type PacketLetterResolver = (path: string) => PacketLetter | undefined;

export interface PacketOpenOptions {
  destination: string;
  workExport?: true;
  letter?: PacketLetter;
  expected?: string[];
  canWrite?(): Promise<boolean>;
  write?(operation: () => Promise<void>): Promise<boolean>;
}

export interface EditorialPacketApi {
  open(plan: EditorialPacket, options: PacketOpenOptions): Promise<void>;
  readLetterSource(plan: EditorialPacket): Promise<string | undefined>;
}

export interface PacketOutput {
  name: string;
  preparePdf?: () => Promise<string>;
  prepareDocx?: () => Promise<ArrayBuffer | Uint8Array>;
  existingDocx?: true;
}

export function packetWorkDestination(edition: TFolder, name: string): string {
  return `${edition.path}/${EDITORIAL_EXPORTS_FOLDER}/${exportFileName(name, "pdf").slice(0, -4)}`;
}

export function isLetterSource(file: TFile, edition: TFolder): boolean {
  return file.parent === edition && editionDocumentForName(file.name)?.id === "lettre-accompagnement";
}

export function editorialPacketSources(edition: TFolder, letterFor?: PacketLetterResolver): TFile[] {
  const files: TFile[] = [];
  function visit(folder: TFolder): void {
    if (!isEditorialSourceFolder(edition, folder.path)) return;
    for (const child of folder.children) {
      if (child instanceof TFolder) visit(child);
      else if (child instanceof TFile && (child.extension.toLowerCase() === "docx"
        || (child.extension === "md" && (!isLetterSource(child, edition) || letterFor?.(child.path))))) files.push(child);
    }
  }
  visit(edition);
  const submissions = edition.children.find(child => child instanceof TFolder && child.name === "Soumissions");
  if (submissions instanceof TFolder && letterFor) {
    for (const folder of submissions.children) {
      if (!(folder instanceof TFolder) || folder.name === "Versions envoyées") continue;
      for (const file of folder.children) {
        if (file instanceof TFile && letterFor(file.path)?.tracked) files.push(file);
      }
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function packetExpectedFiles(plan: EditorialPacket, withLetter: boolean): string[] {
  return packetEntries(plan, withLetter).map(entry => entry.name);
}

function packetEntries(plan: EditorialPacket, withLetter: boolean) {
  const entries = [
    ...plan.sources.map(path => ({ kind: /\.docx$/iu.test(path) ? "attachment" as const : "document" as const, path,
      label: path.slice(path.lastIndexOf("/") + 1).replace(/\.(md|docx)$/iu, "") })),
    ...(plan.manuscript !== "none" ? [{ kind: "manuscript" as const, path: "", label: plan.manuscript === "excerpt" ? "Extrait" : "Manuscrit" }] : []),
  ];
  const letter = { kind: "letter" as const, path: "", label: "Lettre" };
  const body: (typeof entries[number] | typeof letter)[] = entries;
  if (withLetter) body.splice(plan.letterIndex ?? 0, 0, letter);
  const isSeparate = (entry: typeof body[number]) => entry.kind === "attachment"
    || (entry.kind === "manuscript" && plan.manuscriptDocx && plan.format !== "docx");
  const outputName = (entry: typeof body[number], index: number, extension: "docx" | "pdf") =>
    exportFileName(`${String(index + 1).padStart(2, "0")} - ${entry.label}`, extension);
  if (plan.format === "composite") {
    const main = body.filter(entry => !isSeparate(entry));
    const additional = body.flatMap((entry, index) => isSeparate(entry) ? [{
      name: entry.kind === "manuscript" ? exportFileName(entry.label, "docx") : outputName(entry, index, "docx"),
      entries: [entry], format: "docx" as const,
    }] : []);
    return [...(main.length ? [{ name: "Dossier.pdf", entries: main, format: "pdf" as const }] : []), ...additional];
  }
  return body.map((entry, index) => {
    const format = isSeparate(entry) ? "docx" as const : plan.format === "docx" ? "docx" as const : "pdf" as const;
    return { name: entry.kind === "manuscript" && isSeparate(entry) ? exportFileName(entry.label, format) : outputName(entry, index, format),
      entries: [entry], format };
  });
}

export function packetProjectFiles(app: App, settings: FeuilletsSettings, root: TFolder): TFile[] {
  return resolveCompileScopeFiles(app, settings, createProjectScope(root.path));
}

export async function readPacketLetter(app: App, settings: FeuilletsSettings, plan: EditorialPacket, letterFor?: PacketLetterResolver): Promise<string | undefined> {
  if (!plan.letterSource) return undefined;
  const root = getProjectFolder(app, { ...settings, projectFolder: plan.projectRoot });
  const file = app.vault.getAbstractFileByPath(plan.letterSource);
  if (!root || !(file instanceof TFile) || file.extension !== "md" || !file.parent
    || !editionRootPaths(root).some(path => {
      const edition = app.vault.getAbstractFileByPath(path);
      return edition instanceof TFolder && file.parent && isEditorialSourceFolder(edition, file.parent.path);
    })) {
    throw new Error(t("packet.letterSourceUnavailable", { path: plan.letterSource }));
  }
  if (letterFor?.(plan.letterSource)) throw new Error(t("packet.courrierRendererUnavailable"));
  try {
    return stripFrontmatter(await app.vault.read(file)).trim();
  } catch {
    throw new Error(t("packet.letterSourceUnavailable", { path: plan.letterSource }));
  }
}

/** Both consumers use the same native compilation context, with the project
 * captured by the packet. Opening another project in the meantime is safe. */
export function preparePacketOutputs(
  app: App, settings: FeuilletsSettings, plan: EditorialPacket, letter?: PacketLetter, cslHost?: CslCitationHost | null,
  letterFor?: PacketLetterResolver, expected?: readonly string[],
): PacketOutput[] {
  if (!plan.projectRoot || !Array.isArray(plan.sources) || !["composite", "pdf", "docx"].includes(plan.format)
    || !["none", "full", "excerpt"].includes(plan.manuscript)) throw new Error(t("packet.invalidPlan"));
  const scopedSettings = { ...settings, projectFolder: plan.projectRoot };
  const root = getProjectFolder(app, scopedSettings);
  if (!root) throw new Error(t("packet.projectUnavailable", { path: plan.projectRoot }));
  const editions = editionRootPaths(root).map(path => app.vault.getAbstractFileByPath(path)).filter(node => node instanceof TFolder);
  const sources = new Map<string, TFile>();
  const letters = new Map<string, PacketLetter>();
  for (const path of plan.sources) {
    const file = app.vault.getAbstractFileByPath(path);
    const directLetter = file instanceof TFile && file.extension === "md" ? letterFor?.(path) : undefined;
    const edition = file instanceof TFile && file.parent
      ? editions.find(folder => file.parent && (isEditorialSourceFolder(folder, file.parent.path)
        || (directLetter?.tracked && file.parent.parent?.path === folder.path + "/Soumissions"))) : undefined;
    if (!edition || !(file instanceof TFile) || (file.extension !== "md" && file.extension.toLowerCase() !== "docx")
      || (isLetterSource(file, edition) && !directLetter)) {
      throw new Error(t("packet.sourceUnavailable", { path }));
    }
    sources.set(path, file);
    if (directLetter) letters.set(path, directLetter);
  }
  if (plan.manuscript === "excerpt" && !packetProjectFiles(app, scopedSettings, root).some(file => file.path === plan.excerpt)) {
    throw new Error(t("packet.excerptUnavailable", { path: plan.excerpt ?? "" }));
  }
  const identitySettings = settings.projectFolder === root.path ? scopedSettings : { ...scopedSettings, manuscriptTitle: "", manuscriptAuthor: "" };
  const resolvedIdentity = plan.identity ? resolveExportIdentity(app, identitySettings, root) : undefined;
  const identity = resolvedIdentity && {
    author: resolvedIdentity.author.replace(/\s+/gu, " ").trim(),
    title: resolvedIdentity.title.replace(/\s+/gu, " ").trim(),
  };
  const packetHeader = identity ? [identity.author, identity.title].filter(Boolean).join(" · ") : undefined;
  type Entry = ReturnType<typeof packetEntries>[number]["entries"][number];
  async function getContext(entry: Entry) {
    if (!root) throw new Error(t("packet.projectUnavailable", { path: plan.projectRoot }));
    const scope: CompileScope = entry.kind === "document" ? createFileScope(root.path, entry.path)
      : plan.manuscript === "excerpt" && plan.excerpt ? createFileScope(root.path, plan.excerpt) : createProjectScope(root.path);
    if (entry.path && app.vault.getAbstractFileByPath(entry.path) !== sources.get(entry.path)) {
      throw new Error(t("packet.sourceUnavailable", { path: entry.path }));
    }
    if (plan.manuscript === "excerpt" && entry.kind === "manuscript" && !packetProjectFiles(app, scopedSettings, root).some(file => file.path === plan.excerpt)) {
      throw new Error(t("packet.excerptUnavailable", { path: plan.excerpt ?? "" }));
    }
    const prepared = await prepareNativeExport(app, scopedSettings, root, null, scope, null, null, undefined, cslHost);
    if (!prepared?.ctx.segments?.length || !prepared.ctx.markdown.trim()) throw new Error(t("packet.emptySource", { name: entry.label }));
    return prepared.ctx;
  }

  const outputs = packetEntries(plan, !!letter);
  if (expected && (expected.length !== outputs.length || expected.some((name, index) =>
    /[/\\]/u.test(name) || !name.endsWith(`.${outputs[index].format}`)))) throw new Error(t("packet.invalidPlan"));
  return outputs.map(({ name, entries, format }, index) => ({
    name: expected?.[index] ?? name,
    ...(entries[0].kind === "attachment" ? { existingDocx: true as const } : {}),
    ...(format === "pdf" ? { preparePdf: async () => {
      const parts: PrintablePacketPart[] = [];
      for (const entry of entries) {
        const courrier = entry.kind === "letter" ? letter : letters.get(entry.path);
        if (entry.kind === "letter" || courrier) {
          if (!courrier?.print) throw new Error(t("packet.courrierRendererUnavailable"));
          parts.push(await courrier.print());
          continue;
        }
        const part = await preparePdfPrintDocument(app, scopedSettings, { ...await getContext(entry), packetHeader });
        parts.push({ html: part.pagesHtml, css: part.css, lang: scopedSettings.epubLanguage || "fr",
          size: part.geometry.size, orientation: part.geometry.orientation });
      }
      return assemblePacketPrint(plan.name, parts, packetHeader);
    } } : { prepareDocx: async () => {
      const [entry] = entries;
      if (entry.kind === "attachment") {
        const file = sources.get(entry.path);
        if (!file || app.vault.getAbstractFileByPath(entry.path) !== file) throw new Error(t("packet.sourceUnavailable", { path: entry.path }));
        return app.vault.readBinary(file);
      }
      const courrier = entry.kind === "letter" ? letter : letters.get(entry.path);
      if (entry.kind !== "letter" && !courrier) {
        const context = await getContext(entry);
        if (packetHeader) {
          const template = context.template ?? await resolveExportTemplateV2(app, scopedSettings, scopedSettings.exportTemplate);
          context.template = { ...template, firstPage: { ...template.firstPage, hideHeader: false }, header: {
            ...template.header, enabled: true, left: "", center: "", right: "",
          } };
        }
        return exportDocx(app, scopedSettings, { ...context, literalHeader: packetHeader });
      }
      if (!courrier?.docx) throw new Error(t("packet.courrierRendererUnavailable"));
      return courrier.docx(identity);
    } }),
  }));
}

export function scopePacketPrintCss(css: string): string {
  return css.replace(/(^|[{}])(\s*)(?:html\s*,\s*)?body(?=\s*\{)/gu,
    (_match, boundary: string, space: string) => `${boundary}${space}&`);
}

/** Feuillets's generated CSS uses body for the typography defaults. Each
 * set of defaults and all its element rules belong to just one section. */
export function assemblePacketPrint(title: string, parts: PrintablePacketPart[], packetHeader?: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString("<!doctype html><html><head><meta charset='utf-8'><title></title><style></style></head><body></body></html>", "text/html");
  doc.title = title;
  doc.documentElement.lang = parts[0]?.lang ?? "fr";
  const paperMm = new Map([
    ["A4", [210, 297]], ["A5", [148, 210]], ["A6", [105, 148]], ["Letter", [215.9, 279.4]], ["Legal", [215.9, 355.6]],
  ]);
  const css = ["html,body{margin:0;padding:0;background:white;color:black}"];
  for (const [index, part] of parts.entries()) {
    const id = `piece-${index + 1}`;
    const page = `piece${index + 1}`;
    const size = Array.from(paperMm.keys()).find(key => key.toLowerCase() === part.size.toLowerCase()) ?? "A4";
    const orientation = part.orientation === "landscape" ? "landscape" : "portrait";
    const letterHeader = part.marginsMm ? packetHeader : undefined;
    const margins = part.marginsMm?.map(value => Number.isFinite(value) ? Math.max(0, value) : 0);
    if (letterHeader && margins) margins[0] = Math.max(margins[0], PACKET_HEADER_MIN_MARGIN_MM);
    const marginCss = margins?.map(value => value + "mm").join(" ") ?? "0";
    const horizontalOffset = margins ? margins[3] - margins[1] : 0;
    const pageHeader = letterHeader
      ? `@top-center{content:"${letterHeader.replace(/["\\<]/gu, character => "\\" + character.charCodeAt(0).toString(16) + " ")}";${PACKET_HEADER_TYPE};padding-top:${PACKET_HEADER_TOP_MM}mm;padding-left:${Math.max(0, -horizontalOffset)}mm;padding-right:${Math.max(0, horizontalOffset)}mm;vertical-align:top}`
      : "";
    css.push(`@page ${page}{size:${size} ${orientation};margin:${marginCss};${pageHeader}}`,
      `#${id}{page:${page};margin:0!important;padding:0}`,
      index ? `#${id}{break-before:page}` : "",
      `@scope (#${id}){${scopePacketPrintCss(part.css)}}`,
      `#${id}>:last-child{break-after:auto!important;page-break-after:auto!important}`);
    if (margins) {
      const [width, height] = paperMm.get(size) ?? [210, 297];
      const [w, h] = orientation === "landscape" ? [height, width] : [width, height];
      css.push(`@media screen{#${id}{position:relative;box-sizing:border-box;width:${w}mm;min-height:${h}mm;padding:${marginCss};}}`);
      if (letterHeader) css.push(`#${id}>.feuillets-packet-page-header{display:none}
        @media screen{#${id}>.feuillets-packet-page-header{display:block;position:absolute;top:${PACKET_HEADER_TOP_MM}mm;inset-inline:${Math.max(margins[1], margins[3])}mm;${PACKET_HEADER_TYPE}}}`);
    }
    const content = parser.parseFromString(part.html, "text/html");
    content.querySelectorAll("script, iframe, object, embed, link, style").forEach(element => element.remove());
    content.body.querySelectorAll("*").forEach(element => {
      for (const attribute of Array.from(element.attributes)) {
        if (/^on/iu.test(attribute.name) || (/^(href|src|xlink:href)$/iu.test(attribute.name) && /^\s*javascript:/iu.test(attribute.value))) {
          element.removeAttribute(attribute.name);
        }
      }
      if (element.id) element.id = `${id}-${element.id}`;
      const href = element.getAttribute("href");
      if (href?.startsWith("#")) element.setAttribute("href", `#${id}-${href.slice(1)}`);
    });
    const section = doc.createElementNS("http://www.w3.org/1999/xhtml", "section");
    section.id = id;
    section.setAttribute("lang", part.lang);
    if (letterHeader && margins) {
      const header = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      header.className = "feuillets-packet-page-header";
      header.textContent = letterHeader;
      section.append(header);
      content.querySelector<HTMLElement>(".courrier-print-din")?.style.setProperty("--courrier-page-top", margins[0] + "mm");
    }
    section.append(...Array.from(content.body.children, element => doc.importNode(element, true)));
    doc.body.append(section);
  }
  doc.querySelector("style")!.textContent = css.join("\n").replace(/<\/style/giu, "<\\/style");
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
