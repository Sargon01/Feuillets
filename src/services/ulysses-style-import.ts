import type { App } from "obsidian";
import { createCustomTemplateFromV2 } from "./export-templates-custom.js";
import { normalizeV2Template } from "./export-template-v2.js";

type Rules = Record<string, Record<string, string>>;
const pt = (n: number, u: string) => u === "cm" ? n * 28.3465 : u === "mm" ? n * 2.83465 : n;
const length = (raw: string | undefined, base = 12): number | undefined => {
  if (!raw) return undefined;
  const m = raw.trim().match(/^(-?[\d.]+)\s*(pt|mm|cm|em|%)?$/i); if (!m) return undefined;
  const n = Number(m[1]); if (!Number.isFinite(n)) return undefined;
  return m[2] === "em" ? n * base : m[2] === "%" ? n * base / 100 : pt(n, (m[2] || "pt").toLowerCase());
};
const cm = (raw?: string) => { const v = length(raw); return v === undefined ? undefined : Math.round(v / 28.3465 * 100) / 100; };
const bool = (v?: string) => v && /^(yes|true)$/i.test(v);
const align = (v?: string): TemplateAlign | undefined => {
  if (v === "justified") return "justify";
  if (v === "left" || v === "right" || v === "center" || v === "justify") return v;
  return undefined;
};
const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2");

/** Sous-ensemble ULSS à accolades : variables, mixins et cascade plate. */
function parse(content: string): Rules {
  const vars: Record<string, string> = {};
  const rules: Rules = {};
  const clean = content.replace(/\/\/.*$/gm, "").replace(/[^{}\n]*[+>][^{}]*\{[^{}]*\}/g, "");
  for (const m of clean.matchAll(/\$([\w-]+)\s*=\s*([^\n;]+)/g)) vars[m[1]] = m[2].trim();
  const mixins: Rules = {};
  for (const m of clean.matchAll(/@([\w-]+)\s*\{([\s\S]*?)\}/g)) mixins[m[1]] = declarations(m[2], vars);
  const ordinaryRules = clean.replace(/^\s*@[\w-]+\s*\{[\s\S]*?\}/gm, "");
  for (const m of ordinaryRules.matchAll(/([\w-]+)\s*:\s*@([\w-]+)\s*\{([\s\S]*?)\}/g)) {
    if (/^(defaults|paragraph|heading-all|heading-[1-6]|document-settings|paragraph-divider|blockquote|area-header|area-footer)$/.test(m[1])) rules[m[1]] = { ...(mixins[m[2]] || {}), ...declarations(m[3], vars) };
  }
  for (const m of ordinaryRules.matchAll(/([\w-]+)\s*(?::\s*@([\w-]+))?\s*\{([\s\S]*?)\}/g)) {
    const selector = m[1]; if (!/^(defaults|paragraph|heading-all|heading-[1-6]|document-settings|paragraph-divider|blockquote|area-header|area-footer)$/.test(selector)) continue;
    if (m[2]) continue;
    rules[selector] = { ...(m[2] ? mixins[m[2]] || {} : {}), ...declarations(m[3], vars) };
  }
  return rules;
}
function declarations(body: string, vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/([\w-]+)\s*:\s*([^\n;}]+)/g)) {
    let v = m[2].trim().replace(/\$([\w-]+)/g, (_, n) => vars[n] || "0");
    v = v.replace(/([\d.]+(?:pt|mm|cm|em|%)?)\s*([+*/-])\s*([\d.]+(?:pt|mm|cm|em|%)?)/g, (_x, a, op, b) => {
      const av = length(a), bv = length(b); if (av === undefined || bv === undefined) return v;
      return String(op === "+" ? av + bv : op === "-" ? av - bv : op === "*" ? av * bv : av / bv) + "pt";
    }); out[m[1]] = unquote(v);
  } return out;
}
function apply(style: HeadingStyleV2, r: Record<string, string>, base: number): void {
  const size = length(r["font-size"], base); if (size !== undefined) style.fontSizePt = Math.round(size);
  const a = align(r["text-alignment"]); if (a) style.align = a;
  if (r["font-weight"]) style.bold = /^(bold|[6-9]\d\d)$/i.test(r["font-weight"]);
  if (r["font-style"] || r["font-slant"]) style.italic = /italic|oblique/i.test(r["font-style"] || r["font-slant"]);
  for (const [k, out] of [["margin-top", "marginTopPt"], ["margin-bottom", "marginBottomPt"]] as const) { const v = length(r[k], base); if (v !== undefined) style[out] = Math.round(v); }
  style.pageBreakBefore = r["page-break"] === "before";
}
export function parseUlyssesStyle(content: string): ExportTemplateV2 {
  const r = parse(content); if (!Object.keys(r).length) throw new Error("Syntaxe ULSS invalide ou aucune propriété exploitable.");
  const d = r.defaults || {}, p = { ...d, ...(r.paragraph || {}) }, size = length(p["font-size"]) || 12;
  const tpl = normalizeV2Template({ version: 2, profile: "document", page: {} as ExportTemplateV2["page"], body: {} as ExportTemplateV2["body"], headings: {} as ExportTemplateV2["headings"], blockquote: {}, sceneDivider: "", header: {} as ExportTemplateV2["header"], footer: {} as ExportTemplateV2["footer"], firstPage: {} as ExportTemplateV2["firstPage"], titlePage: { styles: {} } });
  tpl.body.fontFamily = p["font-family"] || tpl.body.fontFamily; tpl.body.fontSizePt = Math.round(size); tpl.body.align = align(p["text-alignment"]) || tpl.body.align;
  const lh = length(p["line-height"], size); if (lh !== undefined) tpl.body.lineHeight = /%$/.test(p["line-height"] || "") || /(pt|mm|cm|em)$/.test(p["line-height"] || "") ? lh / size : lh;
  for (const [k, out] of [["first-line-indent", "firstLineIndentPt"], ["margin-top", "paragraphSpacingBeforePt"], ["margin-bottom", "paragraphSpacingAfterPt"]] as const) { const v = length(p[k], size); if (v !== undefined) tpl.body[out] = Math.round(v); }
  if (p.hyphenation) tpl.body.hyphenation = !!bool(p.hyphenation);
  for (let n = 1; n <= 6; n++) apply(tpl.headings[`h${n}` as keyof typeof tpl.headings], { ...d, ...(r["heading-all"] || {}), ...(r[`heading-${n}`] || {}) }, size);
  const doc = r["document-settings"] || {}; const m = [cm(doc["page-inset-top"]), cm(doc["page-inset-bottom"]), cm(doc["page-inset-inner"]), cm(doc["page-inset-outer"])];
  if (m.every((x) => x !== undefined)) { const leftBinding = doc["page-binding"] !== "right"; tpl.page.marginsCm = { top: m[0]!, bottom: m[1]!, left: leftBinding ? m[2]! : m[3]!, right: leftBinding ? m[3]! : m[2]! }; }
  tpl.page.mirrorMargins = !!bool(doc["two-sided"]); const w = length(doc["page-width"]), h = length(doc["page-height"]); if (w && h) { tpl.page.orientation = w > h ? "landscape" : "portrait"; const close = (a:number,b:number)=>Math.abs(a-b)<8; if (close(Math.min(w,h), 595) && close(Math.max(w,h),842)) tpl.page.size="A4"; else if (close(Math.min(w,h),420)&&close(Math.max(w,h),595)) tpl.page.size="A5"; else if (close(Math.min(w,h),612)&&close(Math.max(w,h),792)) tpl.page.size="Letter"; }
  if (/^(portrait|landscape)$/.test(doc["page-orientation"] || "")) tpl.page.orientation = doc["page-orientation"] as "portrait"; const count=Number(doc["column-count"]); if (count>=1) tpl.page.columns.count=count; const gutter=length(doc["column-spacing-width"]); if(gutter!==undefined) tpl.page.columns.gutterPt=Math.round(gutter);
  if (r["paragraph-divider"]?.content) tpl.sceneDivider=r["paragraph-divider"].content; const q=r.blockquote||{}; if(q["font-style"]) tpl.blockquote.italic=/italic/i.test(q["font-style"]); if(q.color&&/^#([\da-f]{3}|[\da-f]{6})$/i.test(q.color)) tpl.blockquote.colorHex=q.color;
  for (const [name, band] of [["area-header", tpl.header], ["area-footer", tpl.footer]] as const) { const x=r[name]; if(!x) continue; band.enabled=x.content!=="none"; const text=x.content==="page-number"?"{page}":(x.content||"").replace(/%p/g,"{page}").replace(/%heading-1/g,"{chapter}"); const a=align(x["text-alignment"]); if(a) band[a as "left"] = text; else band.right=text; }
  return tpl;
}
function slug(name:string){return name.replace(/\.(ulss|ulstyle)$/i,"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"ulysses";}
export async function importUlyssesStyle(app: App, settings: FeuilletsSettings, fileName:string, content:string){return importUlyssesStyleText(app,settings,content,fileName);}
export async function importUlyssesStyleText(app: App, settings: FeuilletsSettings, content:string, fileName:string){ if(!content.trim()) throw new Error("Le fichier est vide."); const label=fileName.replace(/\.(ulss|ulstyle)$/i,"").trim()||"Ulysses"; return createCustomTemplateFromV2(app,settings,slug(fileName),label,parseUlyssesStyle(content)); }
