// Real Obsidian integration. Never connects to a personal vault or a remote endpoint.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import JSZip from "jszip";

const audit = "/private/tmp/feuillets-pedagogie-2026-11-07";
const output = "/private/tmp/feuillets-pedagogy-fixes-2026-11-08";
const vault = `${audit}/vault`;
const course = "TEST-PEDAGOGIE-MESOPOTAMIE/Manuscrit/01 Séance/Cours.md";
const projection = course.replace("Cours.md", "Projection.md");
const sourceHashes = Object.fromEntries(await Promise.all([course, projection].map(async (path) => [path, createHash("sha256").update(await readFile(`${vault}/${path}`)).digest("hex")])));
await mkdir(output, { recursive: true });
const deadline = setTimeout(() => { console.error("Obsidian integration exceeded its 120-second limit"); process.exit(1); }, 120000);
deadline.unref();
const browser = await chromium.connectOverCDP("http://127.0.0.1:9257", { timeout: 10000 });
try {
  const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url() === "app://obsidian.md/index.html");
  assert.ok(page, "No Obsidian app page at the isolated endpoint");
  assert.equal(await page.evaluate(() => window.app?.vault?.adapter?.basePath), vault, "Isolation guard");
  page.setDefaultTimeout(15000);
  if (process.argv.includes("--install")) {
    const pluginId = JSON.parse(await readFile("manifest.json", "utf8")).id;
    for (const name of ["main.js", "styles.css", "manifest.json"]) await copyFile(resolve(name), `${vault}/.obsidian/plugins/${pluginId}/${name}`);
    await page.evaluate(async (id) => { await window.app.plugins.disablePlugin(id); await window.app.plugins.enablePlugin(id); }, pluginId);
    console.log("Installed local build in the isolated audit vault only.");
  }
  if (process.argv.includes("--inspect")) {
    console.log(JSON.stringify(await page.evaluate(() => ({ fullscreen: !!document.fullscreenElement, slide: document.querySelector(".feuillets-presentation-preview-view .feuillets-presentation-render-slide")?.getAttribute("data-slide-index"), body: document.body.innerText.slice(-1000), commands: Object.values(window.app.commands.commands).filter((command) => /présentation|export|édition/i.test(command.name)).map(({ id, name }) => ({ id, name })), plugins: Object.keys(window.app.plugins.plugins) })), null, 2));
    await page.screenshot({ path: `${output}/obsidian-current.png` });
    process.exitCode = 0;
  } else if (process.argv.includes("--ui")) {
    await page.bringToFront();
    await page.evaluate(async () => { if (document.fullscreenElement) void document.exitFullscreen(); });
    await page.evaluate(async (path) => {
      await window.app.workspace.openLinkText(path, "", false);
      window.app.commands.executeCommandById("feuillets:present-current-file-preview");
    }, projection);
    const preview = page.locator(".feuillets-presentation-preview-view");
    await preview.locator(".feuillets-presentation-render-slide").waitFor();
    const toolbar = preview.locator(".feuillets-presentation-toolbar");
    const states = [];
    const total = Number((await preview.locator(".feuillets-presentation-counter").innerText()).split("/").at(-1).trim());
    for (let index = 0; index < total; index++) {
      const slide = preview.locator(".feuillets-presentation-render-slide");
      await slide.locator("img").evaluateAll(async (images) => { await Promise.all(images.map((image) => image.decode().catch(() => {}))); });
      assert.equal(await slide.locator('[data-callout="speaker-notes"]').count(), 0);
      assert.ok(!(await slide.innerText()).includes("NOTE ENSEIGNANT"));
      await preview.locator(".feuillets-presentation-stage").screenshot({ path: `${output}/ui-preview-${String(index + 1).padStart(2, "0")}.png` });
      states.push({ index, counter: await preview.locator(".feuillets-presentation-counter").innerText(), text: await slide.innerText() });
      if (index + 1 < total) {
        await toolbar.locator("button").nth(1).click();
        await page.waitForFunction((index) => document.querySelector(".feuillets-presentation-preview-view .feuillets-presentation-render-slide")?.getAttribute("data-slide-index") === String(index), index + 1, { polling: 100, timeout: 15000 });
      }
    }
    // Return to the first slide and use the actual launch control.
    for (let index = total - 1; index > 0; index--) await toolbar.locator("button").nth(0).click();
    await toolbar.locator("button").last().click();
    await page.waitForFunction(() => !!document.fullscreenElement, null, { polling: 100, timeout: 15000 });
    assert.equal(await preview.locator('[data-callout="speaker-notes"]').count(), 0);
    await page.screenshot({ path: `${output}/ui-fullscreen.png` });
    const fullscreen = await page.evaluate(() => !!document.fullscreenElement);
    await preview.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector(".feuillets-presentation-preview-view .feuillets-presentation-render-slide")?.getAttribute("data-slide-index") === "1", null, { polling: 100, timeout: 15000 });
    await page.evaluate(async () => { if (document.fullscreenElement) void document.exitFullscreen(); });
    await writeFile(`${output}/obsidian-ui.json`, JSON.stringify({ environment: "Actual isolated Obsidian UI", vault, total, fullscreen, states }, null, 2));
    console.log(JSON.stringify({ uiSlides: total, fullscreen, notes: 0 }));
  } else {
    // Keep the complete 1280px slide inside the temporary renderer viewport.
    // Electron otherwise returns a clipped/black region beyond its window.
    await page.setViewportSize({ width: 1400, height: 900 });
    const bundle = await build({ entryPoints: ["test/fixtures/pedagogy-obsidian-entry.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PedagogyIntegration", external: ["obsidian"] });
    // Execute in the plugin loader's native module scope, where Obsidian
    // supplies its real API. This instrumentation exists only in this vault.
    const pluginId = JSON.parse(await readFile("manifest.json", "utf8")).id;
    await writeFile(`${vault}/.obsidian/plugins/${pluginId}/main.js`, `${await readFile("main.js", "utf8")}\n${bundle.outputFiles[0].text}\nwindow.PedagogyIntegration = PedagogyIntegration;\n`);
    await page.evaluate(async (id) => { await window.app.plugins.disablePlugin(id); await window.app.plugins.enablePlugin(id); }, pluginId);
    const result = await page.evaluate(async ({ course, projection }) => {
      const api = window.PedagogyIntegration;
      const plugin = Object.values(window.app.plugins.plugins).find((candidate) => candidate.manifest.id === "feuillets");
      if (!plugin) throw new Error("Feuillets is not loaded");
      const markdown = api.stripFrontmatter(await window.app.vault.read(window.app.vault.getAbstractFileByPath(course)));
      const slideMarkdown = await window.app.vault.read(window.app.vault.getAbstractFileByPath(projection));
      const variant = { id: "student-test", name: "Student", excludedRoles: ["solution"], questionAnswerSpace: "keep" };
      const teacher = await api.renderManuscriptHtml(window.app, markdown, course);
      const solutionTexts = [...teacher.containerEl.querySelectorAll(".feuillets-role-solution .callout-content")].map((solution) => solution.textContent.trim());
      const rendered = await api.renderManuscriptHtml(window.app, markdown, course, [], variant);
      const docx = await api.exportDocx(window.app, plugin.settings, { markdown, title: "Pedagogy validation", author: "", sourcePath: course, contentVariant: variant });
      const composed = rendered.containerEl.cloneNode(true);
      // Compose using the original image-node map, then paginate the exact
      // native DOM. The clone above retains the uncomposed DOCX evidence.
      api.composeDocumentMedia(rendered.containerEl, rendered.images);
      const template = await api.resolveExportTemplate(window.app, plugin.settings, plugin.settings.exportTemplate);
      const pagination = api.paginateManuscript(rendered.containerEl, rendered.footnotes, plugin.settings, template);
      const printHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${api.templateToCss(template)}${api.DOCUMENT_LAYOUT_EXPORT_CSS}@page{size:A4;margin:0}html,body{margin:0;padding:0}.pdf-page{break-after:page;page-break-after:always}.pdf-page:last-child{break-after:auto;page-break-after:auto}</style></head><body>${pagination.pagesHtml}</body></html>`;
      const component = new api.Component(); component.load();
      const slides = await api.planPresentationSlides({ app: window.app, component, sourcePath: projection, markdown: slideMarkdown, theme: api.resolvePresentationTheme("course") });
      const host = document.body.createDiv();
      host.setCssProps({ position: "fixed", left: "0", top: "0", width: "1280px", height: "720px", "z-index": "99999", background: "white" });
      const deck = host.createDiv();
      const measurement = document.body.createDiv();
      const states = [];
      for (let index = 0; index < slides.length; index++) {
        const slide = await api.renderPresentationSlide({ app: window.app, component, sourcePath: projection, markdown: slides[index].markdown, index, generation: 0, measurementHost: measurement, deckContainer: deck, controller: new AbortController(), isGenerationStale: () => false, theme: api.resolvePresentationTheme("course") });
        states.push({ index, text: slide.section.innerText, html: slide.section.outerHTML, overflow: slide.overflow, geometry: slide.geometry, notes: slide.section.querySelectorAll('[data-callout="speaker-notes"]').length, images: slide.section.querySelectorAll("img").length });
        slide.section.remove();
      }
      host.remove(); measurement.remove(); component.unload();
      return { docx: Array.from(docx), html: composed.outerHTML, printHtml, totalPages: pagination.totalPages, solutionTexts, answerLines: rendered.containerEl.querySelectorAll(".feuillets-answer-line").length, solutions: rendered.containerEl.querySelectorAll(".feuillets-role-solution").length, images: rendered.images.size, missing: rendered.missingResources, slides: states, settings: plugin.settings, runtime: navigator.userAgent };
    }, { course, projection });
    assert.equal(result.answerLines, 18); assert.equal(result.solutions, 0); assert.equal(result.images, 3); assert.deepEqual(result.missing, []);
    assert.ok(result.slides.length >= 10); assert.ok(result.slides.every((slide) => slide.notes === 0 && !slide.text.includes("NOTE ENSEIGNANT")));
    const zip = await JSZip.loadAsync(Buffer.from(result.docx));
    const xml = await zip.file("word/document.xml").async("string");
    assert.equal(result.solutionTexts.length, 7);
    const normalized = (text) => text.replace(/<[^>]+>/gu, "").replace(/&apos;/gu, "'").replace(/&amp;/gu, "&").replace(/\s+/gu, " ");
    assert.ok(result.solutionTexts.every((text) => !normalized(xml).includes(normalized(text))));
    assert.equal((xml.match(/<w:bottom /g) || []).length, 18);
    const numbers = [...xml.matchAll(/<w:t xml:space="preserve">(\d+)\. <\/w:t>/gu)].map((match) => Number(match[1]));
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 1, 2, 3]);
    assert.equal(Object.keys(zip.files).filter((name) => /^word\/media\/.+\.(png|jpg)$/u.test(name)).length, 3);
    await writeFile(`${output}/Fiche-eleve-corrected.docx`, Buffer.from(result.docx));
    await writeFile(`${output}/Fiche-eleve-corrected.xml`, xml);
    await writeFile(`${output}/student-native-dom.html`, result.html);
    await writeFile(`${output}/student-pagination-${process.argv.includes("--before-pagination") ? "before" : "after"}.html`, result.printHtml);
    for (const slide of result.slides) {
      await page.evaluate((html) => { const root = document.body.createDiv({ cls: "pedagogy-visual-check" }); root.setCssProps({ position: "fixed", left: "0", top: "0", width: "1280px", height: "720px", "z-index": "99999", background: "white" }); root.innerHTML = html; root.firstElementChild.style.visibility = "visible"; }, slide.html);
      await page.locator(".pedagogy-visual-check img").evaluateAll(async (images) => { await Promise.all(images.map((image) => image.decode().catch(() => {}))); });
      await page.locator(".pedagogy-visual-check").screenshot({ path: `${output}/slide-${String(slide.index + 1).padStart(2, "0")}.png` });
      await page.locator(".pedagogy-visual-check").evaluate((root) => root.remove());
    }
    const { docx: _docx, html: _html, printHtml: _printHtml, ...observations } = result;
    await writeFile(`${output}/obsidian-integration.json`, JSON.stringify({ environment: "Actual isolated Obsidian; production APIs with native MarkdownRenderer", vault, sourceHashes, ...observations }, null, 2));
    console.log(JSON.stringify({ output, slides: result.slides.length, answerLines: result.answerLines, images: result.images, numbers }));
  }
} finally {
  for (const [path, hash] of Object.entries(sourceHashes)) assert.equal(createHash("sha256").update(await readFile(`${vault}/${path}`)).digest("hex"), hash, "Test source must remain unchanged");
  await browser.close(); clearTimeout(deadline);
}
