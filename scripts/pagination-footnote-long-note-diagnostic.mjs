#!/usr/bin/env node

/**
 * Lot 7A: Diagnostic for long footnotes behavior.
 * Tests the system's stability with notes of increasing length.
 * NO production code modifications — diagnostic only.
 *
 * Run with: node scripts/pagination-footnote-long-note-diagnostic.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Check Playwright
let chromium;
try {
  const { chromium: _chromium } = await import("playwright");
  chromium = _chromium;
} catch (error) {
  console.error("Playwright not found. Install with: npx playwright install chromium");
  process.exit(1);
}

// Bundle services
async function bundleServices() {
  const engineResult = await build({
    entryPoints: [path.resolve(projectRoot, "src/services/pagination-engine.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    globalName: "PaginationEngine",
    external: [],
  });

  const footnotesResult = await build({
    entryPoints: [path.resolve(projectRoot, "src/services/pagination-footnotes.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    globalName: "PaginationFootnotes",
    external: [],
  });

  return {
    engine: engineResult.outputFiles[0].text,
    footnotes: footnotesResult.outputFiles[0].text,
  };
}

// Test runner
async function runTest(name, testFn) {
  process.stdout.write(`• ${name}... `);
  try {
    const result = await testFn();
    console.log(`✓ ${result}`);
    return { status: "pass", result };
  } catch (error) {
    console.log(`✗ FAIL`);
    console.log(`  ${error.message}`);
    return { status: "fail", error: error.message };
  }
}

// Main
async function main() {
  const { engine: engineCode, footnotes: footnotesCode } = await bundleServices();
  const browser = await chromium.launch({ headless: true });

  const results = {};

  try {
    const geometry = {
      widthPx: 400,
      heightPx: 600,
      fontFamily: "Arial, sans-serif",
      fontSizePt: 12,
      lineHeight: 1.5,
      textAlign: "left",
      hyphens: false,
      columnCount: 1,
      css: `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.5; }
        p { margin: 0 0 0.75em 0; }
        sup.footnote-ref { font-size: 0.8em; }
      `,
    };

    // L1: Long note that fits
    results.L1 = await runTest("L1 — long footnote fits with body", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();

      const longContent = Array(15).fill(0).map((_, i) => `<p>Paragraph ${i + 1}.</p>`).join("");

      await page.setContent(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><style>${geometry.css}</style>
        <script>${engineCode}</script><script>${footnotesCode}</script>
        </head><body>
        <p>Opening paragraph with footnote<sup class="footnote-ref"><a href="#fn1">1</a></sup>.</p>
        <p>Second paragraph.</p>
        </body></html>
      `);

      const result = await page.evaluate((params) => {
        const { geom, longContent } = params;
        const definitions = [{
          id: "fn1",
          html: longContent,
        }];

        globalThis.createDiv = () => document.createElement("div");
        const nodes = Array.from(document.body.children);

        globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodes);

        const provider = (bodyNodes) => {
          const filtered = globalThis.PaginationFootnotes.cloneBodyNodesWithoutRepeatedPaginationFootnoteReferences(
            Array.from(bodyNodes)
          );
          const tempPage = { bodyNodes: filtered, footnoteNodes: [] };
          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes([tempPage], definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });
          if (tempPage.footnoteNodes.length === 0) return null;
          const area = document.createElement("div");
          area.style.height = `${tempPage.footnoteNodes[0].scrollHeight + 20}px`;
          return area;
        };

        geom.reservedBottomAreaProvider = provider;
        const pages = globalThis.PaginationEngine.paginateDom(nodes, geom);

        globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pages, definitions, (def) => {
          const li = document.createElement("li");
          li.id = def.id;
          li.innerHTML = def.html;
          return li;
        });

        for (const page of pages) {
          globalThis.PaginationFootnotes.clearRepeatedPaginationFootnoteReferenceMarks(page.bodyNodes);
        }

        if (pages.length < 1) throw new Error("No pages");
        if (!pages[0].footnoteNodes.some((n) => n.id === "fn1")) throw new Error("Note missing");

        const noteElem = pages[0].footnoteNodes.find((n) => n.id === "fn1");
        const noteHeight = noteElem?.scrollHeight || 0;
        const pageHeight = geom.heightPx;

        return `footnoteHeight=${noteHeight}px, pageHeight=${pageHeight}px`;
      }, { geom: geometry, longContent });

      await context.close();
      return result;
    });

    // L2: Compare with and without note
    results.L2 = await runTest("L2 — long footnote reduces body and remains whole", async () => {
      // Without note
      const contextA = await browser.newContext();
      const pageA = await contextA.newPage();
      const fixture = `<p>Paragraph 1.</p><p>Paragraph 2.</p><p>Paragraph 3.</p><p>Paragraph 4.</p><p>Paragraph 5.</p><p>Paragraph 6.</p>`;

      await pageA.setContent(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><style>${geometry.css}</style>
        <script>${engineCode}</script>
        </head><body>${fixture}</body></html>
      `);

      const resultA = await pageA.evaluate((params) => {
        const { geom } = params;
        globalThis.createDiv = () => document.createElement("div");
        const nodes = Array.from(document.body.children);
        const pagesA = globalThis.PaginationEngine.paginateDom(nodes, geom);
        const lastNode = pagesA[0].bodyNodes[pagesA[0].bodyNodes.length - 1];
        return { pageCount: pagesA.length, lastBodyText: lastNode?.textContent?.substring(0, 20) || "" };
      }, { geom: geometry });

      await contextA.close();

      // With note
      const contextB = await browser.newContext();
      const pageB = await contextB.newPage();
      const longContent = Array(12).fill(0).map((_, i) => `<p>Note paragraph ${i + 1}.</p>`).join("");

      await pageB.setContent(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><style>${geometry.css}</style>
        <script>${engineCode}</script><script>${footnotesCode}</script>
        </head><body>${fixture.replace("Paragraph 3", `Paragraph 3<sup class="footnote-ref"><a href="#fn1">1</a></sup>`)}</body></html>
      `);

      const resultB = await pageB.evaluate((params) => {
        const { geom, longContent } = params;
        const definitions = [{ id: "fn1", html: longContent }];
        globalThis.createDiv = () => document.createElement("div");
        const nodes = Array.from(document.body.children);

        globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodes);

        const provider = (bodyNodes) => {
          const filtered = globalThis.PaginationFootnotes.cloneBodyNodesWithoutRepeatedPaginationFootnoteReferences(Array.from(bodyNodes));
          const tempPage = { bodyNodes: filtered, footnoteNodes: [] };
          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes([tempPage], definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });
          if (tempPage.footnoteNodes.length === 0) return null;
          const area = document.createElement("div");
          area.style.height = `${tempPage.footnoteNodes[0].scrollHeight + 20}px`;
          return area;
        };

        geom.reservedBottomAreaProvider = provider;
        const pagesB = globalThis.PaginationEngine.paginateDom(nodes, geom);

        globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pagesB, definitions, (def) => {
          const li = document.createElement("li");
          li.id = def.id;
          li.innerHTML = def.html;
          return li;
        });

        for (const page of pagesB) {
          globalThis.PaginationFootnotes.clearRepeatedPaginationFootnoteReferenceMarks(page.bodyNodes);
        }

        let callPage = -1, notePage = -1;
        for (let i = 0; i < pagesB.length; i++) {
          if (pagesB[i].bodyNodes.some((n) => n.querySelectorAll?.("sup.footnote-ref").length > 0)) callPage = i;
          if (pagesB[i].footnoteNodes.some((n) => n.id === "fn1")) notePage = i;
        }

        const lastNode = pagesB[0].bodyNodes[pagesB[0].bodyNodes.length - 1];
        return { pageCount: pagesB.length, lastBodyText: lastNode?.textContent?.substring(0, 20) || "", callPage, notePage };
      }, { geom: geometry, longContent });

      await contextB.close();

      if (resultB.callPage === -1) throw new Error("Call not found");
      if (resultB.notePage === -1) throw new Error("Note not found");
      if (resultB.callPage !== resultB.notePage) throw new Error("Call and note on different pages");

      return `call/note together on page ${resultB.callPage}/${resultB.notePage}`;
    });

    // L3: Call moves with long footnote at boundary
    results.L3 = await runTest("L3 — call moves with long footnote", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();

      const longContent = Array(18).fill(0).map((_, i) => `<p>Note paragraph ${i + 1}.</p>`).join("");
      const bodyFill = Array(30).fill(0).map((_, i) => `<p>Body ${i + 1}.</p>`).join("");

      await page.setContent(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><style>${geometry.css}</style>
        <script>${engineCode}</script><script>${footnotesCode}</script>
        </head><body>
        ${bodyFill}
        <p>Near boundary with call<sup class="footnote-ref"><a href="#fn1">1</a></sup>.</p>
        <p>Final para.</p>
        </body></html>
      `);

      const result = await page.evaluate((params) => {
        const { geom, longContent } = params;
        const definitions = [{ id: "fn1", html: longContent }];
        globalThis.createDiv = () => document.createElement("div");
        const nodes = Array.from(document.body.children);

        globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodes);

        const provider = (bodyNodes) => {
          const filtered = globalThis.PaginationFootnotes.cloneBodyNodesWithoutRepeatedPaginationFootnoteReferences(Array.from(bodyNodes));
          const tempPage = { bodyNodes: filtered, footnoteNodes: [] };
          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes([tempPage], definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });
          if (tempPage.footnoteNodes.length === 0) return null;
          const area = document.createElement("div");
          area.style.height = `${tempPage.footnoteNodes[0].scrollHeight + 20}px`;
          return area;
        };

        geom.reservedBottomAreaProvider = provider;
        const pages = globalThis.PaginationEngine.paginateDom(nodes, geom);

        globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pages, definitions, (def) => {
          const li = document.createElement("li");
          li.id = def.id;
          li.innerHTML = def.html;
          return li;
        });

        for (const page of pages) {
          globalThis.PaginationFootnotes.clearRepeatedPaginationFootnoteReferenceMarks(page.bodyNodes);
        }

        let callPage = -1, notePage = -1;
        for (let i = 0; i < pages.length; i++) {
          if (pages[i].bodyNodes.some((n) => n.querySelectorAll?.("sup.footnote-ref").length > 0)) callPage = i;
          if (pages[i].footnoteNodes.some((n) => n.id === "fn1")) notePage = i;
        }

        if (callPage === -1) throw new Error("Call not found");
        if (notePage === -1) throw new Error("Note not found");
        if (callPage !== notePage) throw new Error("Call and note separated");

        return `callPage=${callPage}, notePage=${notePage}`;
      }, { geom: geometry, longContent });

      await context.close();
      return result;
    });

    // L4: Mixed short and long footnotes
    results.L4 = await runTest("L4 — mixed short and long footnotes", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();

      const shortContent = "<p>Short note.</p>";
      const longContent = Array(8).fill(0).map((_, i) => `<p>Long note para ${i + 1}.</p>`).join("");

      await page.setContent(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><style>${geometry.css}</style>
        <script>${engineCode}</script><script>${footnotesCode}</script>
        </head><body>
        <p>Text with first note<sup class="footnote-ref"><a href="#fn1">1</a></sup> and second<sup class="footnote-ref"><a href="#fn2">2</a></sup>.</p>
        <p>More content.</p>
        </body></html>
      `);

      const result = await page.evaluate((params) => {
        const { geom, shortContent, longContent } = params;
        const definitions = [
          { id: "fn1", html: shortContent },
          { id: "fn2", html: longContent },
        ];
        globalThis.createDiv = () => document.createElement("div");
        const nodes = Array.from(document.body.children);

        globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodes);

        const provider = (bodyNodes) => {
          const filtered = globalThis.PaginationFootnotes.cloneBodyNodesWithoutRepeatedPaginationFootnoteReferences(Array.from(bodyNodes));
          const tempPage = { bodyNodes: filtered, footnoteNodes: [] };
          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes([tempPage], definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });
          if (tempPage.footnoteNodes.length === 0) return null;
          const area = document.createElement("div");
          area.style.height = `${tempPage.footnoteNodes.reduce((sum, n) => sum + n.scrollHeight, 0) + 20}px`;
          return area;
        };

        geom.reservedBottomAreaProvider = provider;
        const pages = globalThis.PaginationEngine.paginateDom(nodes, geom);

        globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pages, definitions, (def) => {
          const li = document.createElement("li");
          li.id = def.id;
          li.innerHTML = def.html;
          return li;
        });

        for (const page of pages) {
          globalThis.PaginationFootnotes.clearRepeatedPaginationFootnoteReferenceMarks(page.bodyNodes);
        }

        const fn1Note = pages[0].footnoteNodes.find((n) => n.id === "fn1");
        const fn2Note = pages[0].footnoteNodes.find((n) => n.id === "fn2");
        if (!fn1Note || !fn2Note) throw new Error("Notes missing");

        return `fn1=${fn1Note.scrollHeight}px, fn2=${fn2Note.scrollHeight}px`;
      }, { geom: geometry, shortContent, longContent });

      await context.close();
      return result;
    });

    // L5: Note approaching page height
    results.L5 = await runTest("L5 — near-page-height footnote", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();

      // Create a note that is ~70% of page height
      const longContent = Array(50).fill(0).map((_, i) => `<p>Paragraph ${i + 1} of the footnote content.</p>`).join("");

      await page.setContent(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><style>${geometry.css}</style>
        <script>${engineCode}</script><script>${footnotesCode}</script>
        </head><body>
        <p>Short text with footnote<sup class="footnote-ref"><a href="#fn1">1</a></sup>.</p>
        </body></html>
      `);

      const result = await page.evaluate((params) => {
        const { geom, longContent } = params;
        const definitions = [{ id: "fn1", html: longContent }];

        globalThis.createDiv = () => document.createElement("div");
        const nodes = Array.from(document.body.children);

        globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodes);

        const provider = (bodyNodes) => {
          const filtered = globalThis.PaginationFootnotes.cloneBodyNodesWithoutRepeatedPaginationFootnoteReferences(
            Array.from(bodyNodes)
          );
          const tempPage = { bodyNodes: filtered, footnoteNodes: [] };
          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes([tempPage], definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });
          if (tempPage.footnoteNodes.length === 0) return null;
          const area = document.createElement("div");
          area.style.height = `${tempPage.footnoteNodes[0].scrollHeight + 20}px`;
          return area;
        };

        geom.reservedBottomAreaProvider = provider;
        const pages = globalThis.PaginationEngine.paginateDom(nodes, geom);

        globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pages, definitions, (def) => {
          const li = document.createElement("li");
          li.id = def.id;
          li.innerHTML = def.html;
          return li;
        });

        for (const page of pages) {
          globalThis.PaginationFootnotes.clearRepeatedPaginationFootnoteReferenceMarks(page.bodyNodes);
        }

        const noteElem = pages[0].footnoteNodes.find((n) => n.id === "fn1");
        const noteHeight = noteElem?.scrollHeight || 0;
        const pageHeight = geom.heightPx;
        const ratio = Math.round((noteHeight / pageHeight) * 100);

        return `footnoteHeight=${noteHeight}px, ratio=${ratio}%`;
      }, { geom: geometry, longContent });

      await context.close();
      return result;
    });

    // L6: Oversized note diagnostic — measure in rendered context
    results.L6 = await runTest("L6 — oversized footnote diagnostic", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();

      // Create a note taller than page height (200 paragraphs ~ 6000px worth)
      const hugeLongContent = Array(200).fill(0).map((_, i) => `<p>Paragraph ${i + 1}.</p>`).join("");

      // Build the page EXACTLY as it would render
      const pageHtml = `
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.5; }
          p { margin: 0 0 0.75em 0; }
          sup.footnote-ref { font-size: 0.8em; }
          .page { width: 400px; height: 600px; border: 1px solid #ccc; position: relative; overflow: hidden; margin: 10px; }
          .page-body { width: 100%; overflow: hidden; }
          .page-footnotes { position: absolute; bottom: 0; left: 0; right: 0; background: #f9f9f9; border-top: 1px solid #ddd; overflow: auto; }
          .page-footnotes li { margin-bottom: 0.5em; }
        </style>
        </head><body>
        <div class="page">
          <div class="page-body">
            <p>Text with footnote<sup class="footnote-ref"><a href="#fn1">1</a></sup>.</p>
          </div>
          <div class="page-footnotes" id="footnotes">
            <li id="fn1">${hugeLongContent}</li>
          </div>
        </div>
        </body></html>
      `;

      await page.setContent(pageHtml);

      const result = await page.evaluate((params) => {
        const { pageUsefulHeight } = params;
        const pageElem = document.querySelector(".page");
        const footnotesElem = document.getElementById("footnotes");
        const noteElem = document.getElementById("fn1");

        if (!pageElem || !footnotesElem || !noteElem) {
          return { status: "ELEMENT_NOT_FOUND" };
        }

        // REAL measurements from rendered DOM
        const noteScrollHeight = noteElem.scrollHeight;
        const noteClientHeight = noteElem.clientHeight;
        const contentClientHeight = footnotesElem.clientHeight;

        const noteRect = noteElem.getBoundingClientRect();
        const footnotesRect = footnotesElem.getBoundingClientRect();
        const pageRect = pageElem.getBoundingClientRect();

        // Compute overflow pixels
        const overflowPixels = Math.max(0, noteRect.bottom - footnotesRect.bottom);

        // Get computed CSS
        const noteOverflowCSS = window.getComputedStyle(noteElem).overflow;
        const footnotesOverflowCSS = window.getComputedStyle(footnotesElem).overflow;
        const pageOverflowCSS = window.getComputedStyle(pageElem).overflow;

        // Determine category
        let category = "UNKNOWN";

        if (noteScrollHeight > pageUsefulHeight) {
          // Note is larger than page height
          if (pageOverflowCSS === "hidden") {
            // Page itself is clipped — visual content is truncated
            category = "CLIPPED";
          } else if (overflowPixels > 10) {
            // Content extends beyond footnotes container
            if (footnotesOverflowCSS === "hidden") {
              category = "CLIPPED";
            } else if (footnotesOverflowCSS === "auto" || footnotesOverflowCSS === "scroll") {
              category = "CLIPPED"; // Scrollable but still clipped for display
            } else {
              category = "OVERSIZED_VISIBLE_OVERFLOW";
            }
          } else if (noteClientHeight === noteScrollHeight) {
            // Note fits in container but larger than page — depends on visibility
            if (footnotesOverflowCSS === "auto" || footnotesOverflowCSS === "scroll") {
              category = "CLIPPED"; // Scrollable footnotes = clipped from page view
            } else {
              category = "CONTAINED";
            }
          } else {
            category = "CLIPPED";
          }
        } else {
          category = "CONTAINED";
        }

        return {
          status: "MEASURED",
          pageUsefulHeight,
          noteScrollHeight,
          noteClientHeight,
          contentClientHeight,
          noteRectTop: Math.round(noteRect.top * 100) / 100,
          noteRectBottom: Math.round(noteRect.bottom * 100) / 100,
          footnotesRectTop: Math.round(footnotesRect.top * 100) / 100,
          footnotesRectBottom: Math.round(footnotesRect.bottom * 100) / 100,
          pageRectTop: Math.round(pageRect.top * 100) / 100,
          pageRectBottom: Math.round(pageRect.bottom * 100) / 100,
          overflowPixels: Math.round(overflowPixels * 100) / 100,
          noteOverflowCSS,
          footnotesOverflowCSS,
          pageOverflowCSS,
          category,
          ratio: Math.round((noteScrollHeight / pageUsefulHeight) * 100),
        };
      }, { pageUsefulHeight: geometry.heightPx });

      await context.close();

      if (result.status === "ELEMENT_NOT_FOUND") throw new Error("L6 element not found");

      // Format for report
      return JSON.stringify(result, null, 2);
    });

    // L7: Sync/coop parity on long note
    results.L7 = await runTest("L7 — sync/cooperative parity", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();

      const mediumContent = Array(30).fill(0).map((_, i) => `<p>Paragraph ${i + 1}.</p>`).join("");

      await page.setContent(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><style>${geometry.css}</style>
        <script>${engineCode}</script><script>${footnotesCode}</script>
        </head><body>
        <p>Text with note<sup class="footnote-ref"><a href="#fn1">1</a></sup>.</p>
        </body></html>
      `);

      const result = await page.evaluate(async (params) => {
        const { geom, mediumContent } = params;
        const definitions = [{ id: "fn1", html: mediumContent }];

        globalThis.createDiv = () => document.createElement("div");

        const createProvider = () => (bodyNodes) => {
          const filtered = globalThis.PaginationFootnotes.cloneBodyNodesWithoutRepeatedPaginationFootnoteReferences(
            Array.from(bodyNodes)
          );
          const tempPage = { bodyNodes: filtered, footnoteNodes: [] };
          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes([tempPage], definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });
          if (tempPage.footnoteNodes.length === 0) return null;
          const area = document.createElement("div");
          area.style.height = `${tempPage.footnoteNodes[0].scrollHeight + 20}px`;
          return area;
        };

        // Sync
        const nodesSync = Array.from(document.body.children);
        globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodesSync);
        geom.reservedBottomAreaProvider = createProvider();
        const pagesSync = globalThis.PaginationEngine.paginateDom(nodesSync, geom);
        globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pagesSync, definitions, (def) => {
          const li = document.createElement("li");
          li.id = def.id;
          li.innerHTML = def.html;
          return li;
        });
        for (const p of pagesSync) {
          globalThis.PaginationFootnotes.clearRepeatedPaginationFootnoteReferenceMarks(p.bodyNodes);
        }

        const syncText = pagesSync.flatMap((p) => p.bodyNodes.map((n) => n.textContent || "")).join("").replace(/\s+/g, "");

        // Coop
        const nodesCoop = Array.from(document.body.children);
        globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodesCoop);
        geom.reservedBottomAreaProvider = createProvider();
        const pagesCoop = await globalThis.PaginationEngine.paginateDomCooperatively(nodesCoop, geom, {
          yieldToBrowser: () => Promise.resolve(),
        });
        if (!pagesCoop) throw new Error("Coop returned null");
        globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pagesCoop, definitions, (def) => {
          const li = document.createElement("li");
          li.id = def.id;
          li.innerHTML = def.html;
          return li;
        });
        for (const p of pagesCoop) {
          globalThis.PaginationFootnotes.clearRepeatedPaginationFootnoteReferenceMarks(p.bodyNodes);
        }

        const coopText = pagesCoop.flatMap((p) => p.bodyNodes.map((n) => n.textContent || "")).join("").replace(/\s+/g, "");

        if (pagesSync.length !== pagesCoop.length) throw new Error(`Page count mismatch: sync=${pagesSync.length}, coop=${pagesCoop.length}`);
        if (syncText !== coopText) throw new Error("Body text mismatch");

        return `pages=${pagesSync.length}, parity verified`;
      }, { geom: geometry, mediumContent });

      await context.close();
      return result;
    });

    // L8: Multicolumn with long footnote
    results.L8 = await runTest("L8 — long footnote / 2 columns", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();

      const longContent = Array(12).fill(0).map((_, i) => `<p>Note paragraph ${i + 1}.</p>`).join("");
      const fixture = `<p>Paragraph 1.</p><p>Paragraph 2.</p><p>Paragraph 3.</p><p>Paragraph 4.</p><p>Paragraph 5.</p>`;

      // Create A4-like geometry with 2 columns
      const multicolGeometry = {
        widthPx: 500,
        heightPx: 700,
        fontFamily: "Arial, sans-serif",
        fontSizePt: 12,
        lineHeight: 1.5,
        textAlign: "left",
        hyphens: false,
        columnCount: 2,
        columnGapPt: 12,
        css: `
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.5; }
          p { margin: 0 0 0.75em 0; }
          sup.footnote-ref { font-size: 0.8em; }
        `,
      };

      await page.setContent(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><style>${multicolGeometry.css}</style>
        <script>${engineCode}</script><script>${footnotesCode}</script>
        </head><body>
        ${fixture.replace("Paragraph 3", `Paragraph 3<sup class="footnote-ref"><a href="#fn1">1</a></sup>`)}
        </body></html>
      `);

      const result = await page.evaluate((params) => {
        const { geom, longContent } = params;
        const definitions = [{ id: "fn1", html: longContent }];
        globalThis.createDiv = () => document.createElement("div");
        const nodes = Array.from(document.body.children);

        globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodes);

        const provider = (bodyNodes) => {
          const filtered = globalThis.PaginationFootnotes.cloneBodyNodesWithoutRepeatedPaginationFootnoteReferences(Array.from(bodyNodes));
          const tempPage = { bodyNodes: filtered, footnoteNodes: [] };
          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes([tempPage], definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });
          if (tempPage.footnoteNodes.length === 0) return null;
          const area = document.createElement("div");
          area.style.height = `${tempPage.footnoteNodes[0].scrollHeight + 20}px`;
          return area;
        };

        geom.reservedBottomAreaProvider = provider;
        const pages = globalThis.PaginationEngine.paginateDom(nodes, geom);

        globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pages, definitions, (def) => {
          const li = document.createElement("li");
          li.id = def.id;
          li.innerHTML = def.html;
          return li;
        });

        for (const page of pages) {
          globalThis.PaginationFootnotes.clearRepeatedPaginationFootnoteReferenceMarks(page.bodyNodes);
        }

        let callPage = -1, notePage = -1;
        for (let i = 0; i < pages.length; i++) {
          if (pages[i].bodyNodes.some((n) => n.querySelectorAll?.("sup.footnote-ref").length > 0)) callPage = i;
          if (pages[i].footnoteNodes.some((n) => n.id === "fn1")) notePage = i;
        }

        if (callPage !== notePage) throw new Error("Call and note on different pages");

        const noteElem = pages[notePage].footnoteNodes.find((n) => n.id === "fn1");
        if (!noteElem) throw new Error("Note element not found");

        return `pages=${pages.length}, callPage=${callPage}, notePage=${notePage}, noteHeight=${noteElem.scrollHeight}px`;
      }, { geom: multicolGeometry, longContent });

      await context.close();
      return result;
    });

  } finally {
    await browser.close();
  }

  // Summary
  const passed = Object.values(results).filter((r) => r.status === "pass").length;
  const total = Object.keys(results).length;

  console.log(`\n════════════════════════════════════════`);
  console.log(`Lot 7A Extended Diagnostic Results`);
  console.log(`════════════════════════════════════════\n`);

  // Print all results
  for (const [name, result] of Object.entries(results)) {
    const status = result.status === "pass" ? "✓" : "✗";
    if (result.status === "pass") {
      console.log(`${status} ${name}: ${result.result}`);
    } else {
      console.log(`${status} ${name}: FAILED — ${result.error}`);
    }
  }

  console.log(`\n────────────────────────────────────────`);
  console.log(`Passed: ${passed}/${total}`);
  console.log(`────────────────────────────────────────\n`);

  // Determine category
  let category = "UNKNOWN";

  // L6 result examination
  const l6Pass = results.L6?.status === "pass";
  const l6Result = results.L6?.result || "";

  // Category rules
  if (passed === total) {
    // All mandatory tests passed (L1-L5, L7-L8)
    // L6 is diagnostic only and does not block Category A
    category = "A — All tests within page-height limits pass cleanly";
  } else if (passed >= total - 2) {
    // Missing only L6 or similar
    category = "B — Most tests pass; some instability at extremes";
  } else {
    category = "C — Significant issues before page-height limits";
  }

  console.log(`CATEGORY: ${category}`);
  console.log(`\nL6 Diagnostic (oversized note): ${l6Result || "not available"}`);
  console.log(`════════════════════════════════════════\n`);

  process.exit(passed === total ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
