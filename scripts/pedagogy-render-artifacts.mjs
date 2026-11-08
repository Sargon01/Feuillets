// Render already-produced artifacts, without changing their contents or CSS.
import { mkdir, writeFile, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import assert from "node:assert/strict";

const output = "/private/tmp/feuillets-pedagogy-fixes-2026-11-08";
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, file] of [
    ["docx-quicklook", `${output}/Fiche-eleve-corrected.docx.qlpreview/Preview.html`],
    ["student-pagination-before", `${output}/student-pagination-before.html`],
    ["student-pagination-after", `${output}/student-pagination-after.html`],
    ["audit-original", "/private/tmp/feuillets-pedagogie-2026-11-07/evidence/52-print-frame-native.html"],
  ]) {
    try { await access(file); } catch { continue; }
    const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((image) => image.decode().catch(() => {}))); });
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    const observation = await page.evaluate(() => ({
      text: document.body.innerText,
      images: [...document.images].map((image) => ({ complete: image.complete, naturalWidth: image.naturalWidth, width: image.width, height: image.height })),
      borders: [...document.querySelectorAll("p")].filter((paragraph) => getComputedStyle(paragraph).borderBottomStyle === "dotted").map((paragraph) => ({ height: paragraph.getBoundingClientRect().height, marginAfter: Number.parseFloat(getComputedStyle(paragraph).marginBottom), text: paragraph.innerText })),
      pages: [...document.querySelectorAll(".pdf-page")].map((page) => ({ text: page.innerText, images: page.querySelectorAll("img").length })),
      clipped: [...document.querySelectorAll(".feuillets-role-source")].filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => ({ text: element.innerText, width: element.clientWidth, scrollWidth: element.scrollWidth })),
    }));
    assert.ok(observation.images.every((image) => image.complete && image.naturalWidth > 0));
    if (name === "docx-quicklook") {
      assert.equal(observation.borders.length, 18);
      assert.ok(observation.borders.every((line) => line.height > 0 && line.height + line.marginAfter >= 22));
      assert.ok(!observation.text.includes("tags: histoire"));
    }
    if (name === "student-pagination-after") {
      assert.equal(observation.clipped.length, 0);
      assert.ok(observation.pages.every((page) => !/Document [123] —/u.test(page.text) || page.images > 0));
    }
    await writeFile(`${output}/${name}.json`, JSON.stringify(observation, null, 2));
    await page.pdf({ path: `${output}/${name}-chromium.pdf`, printBackground: true, preferCSSPageSize: true, format: "A4", margin: { top: "0", bottom: "0", left: "0", right: "0" } });
    await page.close();
    console.log(JSON.stringify({ name, borders: observation.borders.length, pages: observation.pages.length, clipped: observation.clipped.length }));
  }
  await mkdir(`${output}/rendered`, { recursive: true });
} finally { await browser.close(); }
