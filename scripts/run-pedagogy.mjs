import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import JSZip from "jszip";

const output = resolve(process.env.FEUILLETS_PEDAGOGY_OUTPUT || "/private/tmp/feuillets-pedagogy-validation");
await mkdir(output, { recursive: true });
const suites = ["docx-blocks", "pagination-engine", "presentation-private-notes", "presentation", "presentation-slide-planner", "presentation-slide-renderer", "presentation-layout-engine", "presentation-plan", "presentation-a4-composition", "presentation-pdf-export", "content-variants", "content-variant-render", "document-layout"];
for (const [command, args] of [
  [process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.test.json"]],
  [process.execPath, ["scripts/prepare-test-obsidian-stub.mjs"]],
  [process.execPath, ["--disable-warning=DEP0151", "--import", "./.test-dist/test/i18n-test-bootstrap.js", "--test", ...suites.map((name) => `.test-dist/test/${name}.test.js`)]],
]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  await writeFile(resolve(output, command === process.execPath && args.includes("--test") ? "unit-tests.log" : `setup-${args[0].split("/").at(-1)}.log`), result.stdout + result.stderr);
  if (result.status !== 0) { process.stderr.write(result.stdout + result.stderr); process.exit(result.status || 1); }
}

const bundle = await build({
  entryPoints: ["test/fixtures/pedagogy-browser-entry.ts"], bundle: true, write: false, format: "iife", globalName: "Pedagogy",
  platform: "browser", alias: { obsidian: resolve("test/obsidian-runtime-stub.mjs") },
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 850, height: 1100 } });
  await page.setContent("<!doctype html><html><head><style>body{font:16px Arial;margin:40px}.callout-title{font-weight:bold}.feuillets-answer-line{display:block;height:1.55em;border-bottom:1px dotted;margin-bottom:.7em}li{margin-bottom:12px}</style></head><body></body></html>");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const api = globalThis.Pedagogy;
    const root = document.createElement("div");
    const markdown = [];
    for (let number = 1; number <= 6; number++) {
      markdown.push(`> [!questions]\n> ${number}. Question ${number}\n\n> [!solution]\n> Secret ${number}`);
      root.insertAdjacentHTML("beforeend", `<div class="callout" data-callout="questions"><div class="callout-content"><ol start="${number}"><li>Question ${number}<span class="feuillets-answer-line"></span><span class="feuillets-answer-line"></span><span class="feuillets-answer-line"></span></li></ol></div></div><div class="callout" data-callout="solution"><p>Secret ${number}</p></div>`);
    }
    root.insertAdjacentHTML("beforeend", '<p><img alt="Preserved image"></p><div class="callout" data-callout="source"><p>Preserved caption</p></div>');
    document.body.append(root);
    api.applySemanticRoles(root);
    api.applyDocxListNumbers(root, markdown.join("\n\n"));
    const teacherSolutions = root.querySelectorAll(".feuillets-role-solution").length;
    const student = { excludedRoles: ["solution"], questionAnswerSpace: "keep" };
    api.applyContentVariant(root, student);
    const image = root.querySelector("img");
    const imageBytes = Uint8Array.from(window.atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="), (value) => value.charCodeAt(0));
    const images = new Map([[image, { bytes: imageBytes, ext: "png", width: 20, height: 20, caption: "Preserved image" }]]);
    const blocks = api.blockToParagraphs(root, new Map(), { key: "document", label: "Document", indent: false, fontSizePt: 12 }, {}, images);
    const bytes = await api.Packer.toBase64String(new api.Document({ sections: [{ children: blocks }] }));
    const count = root.querySelectorAll(".feuillets-answer-line").length;
    const solutions = root.querySelectorAll(".feuillets-role-solution").length;
    const numbers = [...root.querySelectorAll("li")].map((li) => li.getAttribute("value"));
    const hidden = root.cloneNode(true);
    api.applyContentVariant(hidden, { ...student, questionAnswerSpace: "hide" });
    const listCases = document.createElement("div");
    listCases.innerHTML = '<ol start="4"><li>Four<ol start="2"><li>Nested</li></ol></li><li>Eight</li><li>Nine</li></ol><p>Interruption</p><ol><li>Restart</li></ol>';
    api.applyDocxListNumbers(listCases, "4. Four\n   2. Nested\n8. Eight\n9. Nine\n\nInterruption\n\n1. Restart");
    window.createDiv = () => document.createElement("div");
    const paginationSource = document.createElement("div");
    paginationSource.innerHTML = '<p style="height:160px">Prior content</p><p><strong>Document title</strong></p><div class="feuillets-document-media-role-pair feuillets-document-media-role-pair-side"><div class="feuillets-doc-media-block" style="height:180px">Image fixture</div><div class="feuillets-semantic-role feuillets-role-source">https://museum.example/collection/' + "longidentifier".repeat(12) + '</div></div>';
    const css = api.templateToCss(api.EXPORT_TEMPLATES.documentSimple);
    const pages = api.paginateDom([...paginationSource.children], { widthPx: 600, heightPx: 300, fontFamily: "Arial", fontSizePt: 12, lineHeight: 1.25, textAlign: "left", css });
    const pagination = pages.map((page) => ({ text: page.bodyNodes.map((node) => node.textContent).join(""), title: page.bodyNodes.some((node) => node.querySelector("strong")), media: page.bodyNodes.some((node) => node.classList.contains("feuillets-document-media-role-pair")) }));
    const wrapCheck = document.createElement("div");
    wrapCheck.style.width = "600px";
    const style = document.createElement("style"); style.textContent = css; wrapCheck.append(style, paginationSource.lastElementChild.cloneNode(true)); document.body.append(wrapCheck);
    const source = wrapCheck.querySelector(".feuillets-role-source");
    const referenceFits = source.scrollWidth <= source.clientWidth + 1;
    wrapCheck.remove();
    return { bytes, teacherSolutions, count, solutions, numbers, hiddenCount: hidden.querySelectorAll(".feuillets-answer-line").length,
      pagination, referenceFits,
      explicitNumbers: [...listCases.querySelectorAll("li")].map((li) => li.getAttribute("value")), images: root.querySelectorAll("img").length,
      html: root.outerHTML, roles: [...root.querySelectorAll(".feuillets-semantic-role")].map((role) => role.className) };
  });
  assert.equal(result.teacherSolutions, 6);
  assert.equal(result.count, 18);
  assert.equal(result.solutions, 0);
  assert.equal(result.hiddenCount, 0);
  assert.deepEqual(result.numbers, ["1", "2", "3", "4", "5", "6"]);
  assert.deepEqual(result.explicitNumbers, ["4", "2", "8", "9", "1"]);
  assert.equal(result.images, 1);
  assert.ok(result.pagination.every((page) => !page.title || page.media));
  assert.equal(result.referenceFits, true);
  const bytes = Buffer.from(result.bytes, "base64");
  await writeFile(resolve(output, "student-dom-fixture.docx"), bytes);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml").async("string");
  assert.equal((xml.match(/<w:bottom /g) || []).length, 18);
  assert.doesNotMatch(xml, /Secret/);
  for (let number = 1; number <= 6; number++) assert.ok(xml.includes(`<w:t xml:space="preserve">${number}. </w:t>`));
  assert.equal(Object.keys(zip.files).filter((name) => /^word\/media\/.+\.png$/u.test(name)).length, 1);
  await writeFile(resolve(output, "student-dom-fixture.xml"), xml);
  await page.screenshot({ path: resolve(output, "student-dom-fixture.png"), fullPage: true });
  const { bytes: _bytes, ...observations } = result;
  await writeFile(resolve(output, "browser-report.json"), JSON.stringify({ environment: "Headless Chromium; rendered DOM fixture, not Obsidian", ...observations }, null, 2));
  console.log(`Pedagogy unit, browser DOM and OOXML checks passed. Evidence: ${output}`);
} finally { await browser.close(); }

// Optional application checks are explicit: a DOM fixture must never be
// reported as a successful test of the actual Obsidian application.
if (process.argv.includes("--obsidian")) {
  for (const args of [[], ["--ui"]]) {
    const result = spawnSync(process.execPath, ["scripts/pedagogy-obsidian.mjs", ...args], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
