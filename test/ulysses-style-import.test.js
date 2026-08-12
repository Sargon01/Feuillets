import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { parseUlyssesStyle, importUlyssesStyle } from "../src/services/ulysses-style-import.js";

const ULSS = `// vrai ULSS
$base-size = 12pt
@heading { font-weight: bold; margin-bottom: 10pt }
document-settings { page-width: 210mm; page-height: 297mm; page-inset-top: 2cm; page-inset-bottom: 2cm; page-inset-inner: 3cm; page-inset-outer: 2cm; page-binding: right; two-sided: yes; column-count: 2; column-spacing-width: 1em }
defaults { font-family: "Times New Roman"; font-size: $base-size; line-height: 200%; text-alignment: justified }
paragraph { first-line-indent: 1.5em; margin-top: 3pt; margin-bottom: 4pt; hyphenation: yes }
heading-all { font-style: italic }
heading-1 : @heading { font-size: $base-size * 2; font-weight: bold; text-alignment: center; page-break: before; margin-bottom: 12pt }
heading-2 { font-size: 18pt } heading-3 { font-size: 17pt } heading-4 { font-size: 16pt } heading-5 { font-size: 15pt } heading-6 { font-size: 14pt }
paragraph-divider { content: "* * *" }
area-header { content: "%heading-1"; text-alignment: left }
area-footer { content: "%p"; text-alignment: center }
paragraph + paragraph { font-size: 99pt } unknown { foo: bar }`;

test("ULSS réel : variables, mixin, cascade, unités et V2 complet", () => {
  const t = parseUlyssesStyle(ULSS);
  assert.equal(t.version, 2); assert.equal(t.profile, "document");
  assert.equal(t.page.size, "A4"); assert.equal(t.page.orientation, "portrait"); assert.deepEqual(t.page.marginsCm,{top:2,bottom:2,left:2,right:3}); assert.equal(t.page.mirrorMargins,true); assert.deepEqual(t.page.columns,{count:2,gutterPt:12});
  assert.deepEqual(t.body,{fontFamily:"Times New Roman",fontSizePt:12,lineHeight:2,align:"justify",firstLineIndentPt:18,paragraphSpacingBeforePt:3,paragraphSpacingAfterPt:4,hyphenation:true});
  assert.deepEqual(t.headings.h1,{fontSizePt:24,bold:true,italic:true,marginBottomPt:12,pageBreakBefore:true,align:"center"});
  for(let n=2;n<=6;n++) assert.equal(t.headings[`h${n}`].fontSizePt,20-n);
  assert.equal(t.sceneDivider,"* * *"); assert.equal(t.header.left,"{chapter}"); assert.equal(t.footer.center,"{page}");
  for(const k of ["indent","indentPt","paragraphSpacing","marginCm","chapterTitle"]) assert.equal(k in t,false);
});
test("ULSS : déclarations locales priment, inconnues et contextuelles n'affectent rien",()=>{const t=parseUlyssesStyle(`$x = 10pt @m { font-size: 20pt } defaults { font-size: $x } paragraph : @m { font-size: 11pt } paragraph + paragraph { font-size: 99pt }`);assert.equal(t.body.fontSizePt,11);});
test("ULSS : heading-all transmet sa police à tous les niveaux sans remplacer celle du corps", () => {
  const t = parseUlyssesStyle(`defaults { font-family: "Times New Roman" } heading-all { font-family: "Arial" }`);
  assert.equal(t.body.fontFamily, "Times New Roman");
  for (let n = 1; n <= 6; n++) assert.equal(t.headings[`h${n}`].fontFamily, "Arial");
});
test("ULSS : heading-1 remplace seulement la police de heading-all et conserve les autres propriétés", () => {
  const t = parseUlyssesStyle(`defaults { font-family: "Garamond"; font-size: 12pt } heading-all { font-family: "Helvetica"; font-size: 18pt; font-weight: bold; font-style: italic; text-alignment: center; margin-top: 4pt; margin-bottom: 5pt; page-break: before } heading-1 { font-family: "Futura" }`);
  assert.deepEqual(t.headings.h1, { fontSizePt: 18, fontFamily: "Futura", bold: true, italic: true, align: "center", marginTopPt: 4, marginBottomPt: 5, pageBreakBefore: true });
  assert.equal(t.headings.h2.fontFamily, "Helvetica");
  assert.equal(t.headings.h2.fontSizePt, 18);
});
test("ULSS : sans police de titre, les titres héritent toujours de la police du corps", () => {
  const t = parseUlyssesStyle(`defaults { font-family: "Times New Roman" } heading-all { font-size: 18pt }`);
  assert.equal(t.body.fontFamily, "Times New Roman");
  for (let n = 1; n <= 6; n++) assert.equal("fontFamily" in t.headings[`h${n}`], false);
});
test("ULSS : des polices de corps et de titres distinctes conservent les métriques et le saut de section", () => {
  const t = parseUlyssesStyle(`document-settings { section-break: heading-1 } defaults { font-family: Cochin; font-size: 12pt } heading-all { font-family: Futura } heading-1 { font-size: 33pt; margin-top: 64pt; margin-bottom: 64pt } heading-2 { font-size: 22pt }`);
  assert.equal(t.body.fontFamily, "Cochin");
  assert.equal(t.headings.h1.fontFamily, "Futura");
  assert.equal(t.headings.h1.fontSizePt, 33);
  assert.equal(t.headings.h1.marginTopPt, 64);
  assert.equal(t.headings.h1.marginBottomPt, 64);
  assert.equal(t.headings.h1.pageBreakBefore, true);
  assert.equal(t.headings.h2.fontFamily, "Futura");
  assert.equal(t.headings.h2.fontSizePt, 22);
});
test("import ULSS : écrit un V2 et active la clé",async()=>{const project=new TFolder("Projet"), manuscript=new TFolder("Projet/Manuscrit"); manuscript.parent=project;project.children=[manuscript];const {vault,fileManager}=createFakeVault([project,manuscript]);const app={vault,fileManager,metadataCache:{getFileCache:()=>({frontmatter:{}})}};const settings={projectFolder:manuscript.path,exportTemplate:"classique",pdfHeaderLeft:"inchangé"};const r=await importUlyssesStyle(app,settings,"Mon Style.ulss",ULSS);assert.ok(r);const file=vault.getAbstractFileByPath(`Projet/_Feuillets/Ressources/Mises en page/${r.key}.md`);assert.ok(file instanceof TFile);assert.match(file.content,/version: 2/);assert.match(file.content,/profile: document/);assert.equal(settings.exportTemplate,r.key);assert.equal(settings.pdfHeaderLeft,"inchangé");});
test("import ULSS : .ulstyle est accepté",async()=>{const project=new TFolder("P"), manuscript=new TFolder("P/M");manuscript.parent=project;project.children=[manuscript];const {vault,fileManager}=createFakeVault([project,manuscript]);const r=await importUlyssesStyle({vault,fileManager,metadataCache:{getFileCache:()=>({frontmatter:{}})}},{projectFolder:"P/M",exportTemplate:"classique"},"Style.ulstyle",ULSS);assert.equal(r.label,"Style");});
test("import ULSS : la clé est unique",async()=>{const project=new TFolder("P"), manuscript=new TFolder("P/M");manuscript.parent=project;project.children=[manuscript];const {vault,fileManager}=createFakeVault([project,manuscript]);const app={vault,fileManager,metadataCache:{getFileCache:()=>({frontmatter:{}})}};const settings={projectFolder:"P/M",exportTemplate:"classique"};const a=await importUlyssesStyle(app,settings,"Style.ulss",ULSS),b=await importUlyssesStyle(app,settings,"Style.ulss",ULSS);assert.notEqual(a.key,b.key);});
test("import ULSS : sans projet retourne null",async()=>{const {vault,fileManager}=createFakeVault([]);const r=await importUlyssesStyle({vault,fileManager,metadataCache:{getFileCache:()=>({frontmatter:{}})}},{projectFolder:"x",exportTemplate:"classique"},"Style.ulss",ULSS);assert.equal(r,null);});
