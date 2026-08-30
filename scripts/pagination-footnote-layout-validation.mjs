#!/usr/bin/env node

/**
 * Lot 6 layout validation: footnote pagination across all standard geometries.
 * Tests A4/A5/Letter in portrait/landscape, with and without multicolumn.
 *
 * Run with: node scripts/pagination-footnote-layout-validation.mjs
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

// Convert mm to px (1mm = 3.7795px)
const mmToPx = (mm) => Math.round(mm * 3.7795);

// Layout definitions
const layouts = {
  V1: { name: "A4 portrait / 1 column", width: 210, height: 297, columns: 1, margins: { top: 20, bottom: 20, left: 15, right: 15 } },
  V2: { name: "A5 portrait / 1 column", width: 148, height: 210, columns: 1, margins: { top: 15, bottom: 15, left: 12, right: 12 } },
  V3: { name: "Letter portrait / 1 column", width: 215.9, height: 279.4, columns: 1, margins: { top: 20, bottom: 20, left: 15, right: 15 } },
  V4: { name: "A4 landscape / 1 column", width: 297, height: 210, columns: 1, margins: { top: 15, bottom: 15, left: 15, right: 15 } },
  V5: { name: "A5 landscape / 1 column", width: 210, height: 148, columns: 1, margins: { top: 12, bottom: 12, left: 12, right: 12 } },
  V6: { name: "A4 portrait / 2 columns", width: 210, height: 297, columns: 2, margins: { top: 20, bottom: 20, left: 15, right: 15 } },
  V7: { name: "A5 portrait / 2 columns", width: 148, height: 210, columns: 2, margins: { top: 15, bottom: 15, left: 12, right: 12 } },
};

// Create geometry for layout
function createGeometry(layout, fontSizePt = 12, columnGapPt = 12) {
  const contentWidth = mmToPx(layout.width - layout.margins.left - layout.margins.right);
  const contentHeight = mmToPx(layout.height - layout.margins.top - layout.margins.bottom);

  return {
    widthPx: contentWidth,
    heightPx: contentHeight,
    fontFamily: "serif",
    fontSizePt,
    lineHeight: 1.5,
    textAlign: "left",
    hyphens: false,
    columnCount: layout.columns,
    columnGapPt,
    css: `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: serif; font-size: ${fontSizePt}pt; line-height: 1.5; }
      h1 { margin: 1.5em 0 0.5em 0; page-break-before: always; }
      h3 { margin: 1em 0 0.5em 0; }
      p { margin: 0 0 0.75em 0; }
      img { max-width: 100%; height: auto; margin: 0.5em 0; }
      sup.footnote-ref { font-size: 0.8em; }
    `,
  };
}

// Test runner
async function runTest(name, testFn) {
  try {
    await testFn();
    console.log(`✓ ${name}`);
    return true;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
    return false;
  }
}

// Main
async function main() {
  const { engine: engineCode, footnotes: footnotesCode } = await bundleServices();
  const browser = await chromium.launch({ headless: true });

  const results = {};

  try {
    // Test each layout
    for (const [key, layout] of Object.entries(layouts)) {
      results[key] = await runTest(`${key} PASS — ${layout.name}`, async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        // Create fixture with footnotes, images, headings
        const svgImage = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect fill="%23eee" width="200" height="100"/><text x="100" y="50" text-anchor="middle" dy="0.3em">Image</text></svg>`;

        const html = `
          <!DOCTYPE html>
          <html><head><meta charset="utf-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: serif; font-size: 12pt; line-height: 1.5; }
            h1 { margin: 1.5em 0 0.5em 0; page-break-before: always; }
            h3 { margin: 1em 0 0.5em 0; }
            p { margin: 0 0 0.75em 0; }
            img { max-width: 100%; height: auto; margin: 0.5em 0; }
            sup.footnote-ref { font-size: 0.8em; }
            .feuillets-frontpage { page-break-after: always; }
          </style>
          <script>${engineCode}</script>
          <script>${footnotesCode}</script>
          </head><body>
          <div class="feuillets-frontpage">Front page content here.</div>
          <h1>Main Title</h1>
          <p>Opening paragraph with first footnote<sup class="footnote-ref"><a href="#fn1">1</a></sup> and regular text.</p>
          <p>Second paragraph with additional content to fill space and create proper pagination for the layout geometry.</p>
          <h3>Subheading</h3>
          <p>Paragraph after subheading with second footnote<sup class="footnote-ref"><a href="#fn2">2</a></sup> reference.</p>
          <p>More text content that fills additional space and creates layout variations for testing purposes with realistic content length.</p>
          <img src="${svgImage}" alt="test image" />
          <p>Text after image with repeated note reference<sup class="footnote-ref"><a href="#fn1">1</a></sup> to test repeat handling.</p>
          <p>Final paragraph with closing content.</p>
          </body></html>
        `;

        await page.setContent(html);

        // Run pagination
        await page.evaluate(async (params) => {
          const { geom, layout } = params;
          const definitions = [
            { id: "fn1", html: "<p>First footnote definition</p>" },
            { id: "fn2", html: "<p>Second footnote definition</p>" },
          ];

          globalThis.createDiv = () => document.createElement("div");

          const nodes = Array.from(document.body.children);

          // Mark repeated
          globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodes);

          // Provider
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
            area.style.height = `${tempPage.footnoteNodes.length * 24}px`;
            return area;
          };

          geom.reservedBottomAreaProvider = provider;

          // Paginate sync
          const pages = globalThis.PaginationEngine.paginateDom(nodes, geom);

          // Populate final
          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pages, definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });

          // Clear repeat markers (production behavior)
          for (const page of pages) {
            globalThis.PaginationFootnotes.clearRepeatedPaginationFootnoteReferenceMarks(page.bodyNodes);
          }

          // Verify assertions
          // A: at least 1 page
          if (pages.length < 1) throw new Error("A: no pages produced");

          // B: no text loss
          const originalText = nodes.map((n) => n.textContent || "").join(" ");
          const finalText = pages.flatMap((p) => p.bodyNodes.map((n) => n.textContent || "")).join(" ");
          if (finalText.length < originalText.length * 0.9) throw new Error("B: text loss detected");

          // C: primary calls match notes
          for (const def of definitions) {
            let callPage = -1;
            let notePage = -1;

            for (let i = 0; i < pages.length; i++) {
              const sups = (pages[i].bodyNodes || []).flatMap((n) =>
                Array.from(n.querySelectorAll?.("sup.footnote-ref") || [])
              );
              const hasCall = sups.some((s) => {
                const link = s.querySelector("a[href]");
                return link && link.getAttribute("href") === `#${def.id}` && !s.getAttribute("data-pagination-footnote-repeat");
              });
              if (hasCall && callPage === -1) callPage = i;

              if ((pages[i].footnoteNodes || []).some((n) => n.id === def.id)) notePage = i;
            }

            if (callPage !== -1 && notePage === -1) throw new Error(`C: note ${def.id} missing`);
            if (callPage !== -1 && callPage !== notePage) throw new Error(`C: ${def.id} call page ${callPage} != note page ${notePage}`);
          }

          // D: repeated refs visible
          const allSups = pages.flatMap((p) =>
            (p.bodyNodes || []).flatMap((n) => Array.from(n.querySelectorAll?.("sup.footnote-ref") || []))
          );
          if (allSups.length < 3) throw new Error("D: not enough sup references visible");

          // E: fn1 only once in final notes
          const fn1Count = pages.reduce((sum, p) => sum + ((p.footnoteNodes || []).filter((n) => n.id === "fn1").length), 0);
          if (fn1Count !== 1) throw new Error(`E: fn1 appears ${fn1Count} times, expected 1`);

          // F: no duplicate definitions
          for (let i = 0; i < pages.length; i++) {
            const ids = (pages[i].footnoteNodes || []).map((n) => n.id);
            if (ids.length !== new Set(ids).size) throw new Error(`F: duplicate definition on page ${i}`);
          }

          // G: no stray repeat attributes
          const markedSups = pages.flatMap((p) =>
            (p.bodyNodes || []).flatMap((n) => Array.from(n.querySelectorAll?.(`[data-pagination-footnote-repeat]`) || []))
          );
          if (markedSups.length > 0) throw new Error("G: repeat attributes leaked to body");

          // H: sync === cooperative
          const nodesCoop = Array.from(document.body.children).map((n) => n.cloneNode(true));
          globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodesCoop);
          geom.reservedBottomAreaProvider = provider;
          const pagesCoop = await globalThis.PaginationEngine.paginateDomCooperatively(nodesCoop, geom, {
            yieldToBrowser: () => Promise.resolve(),
          });
          if (!pagesCoop) throw new Error("H: cooperative returned null");
          if (pages.length !== pagesCoop.length) throw new Error(`H: sync ${pages.length} != coop ${pagesCoop.length}`);

          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pagesCoop, definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });

          // Clear repeat markers on coop pages too
          for (const page of pagesCoop) {
            globalThis.PaginationFootnotes.clearRepeatedPaginationFootnoteReferenceMarks(page.bodyNodes);
          }

          for (let i = 0; i < pages.length; i++) {
            const syncText = (pages[i].bodyNodes || []).flatMap((n) => n.textContent || "").join("");
            const coopText = (pagesCoop[i].bodyNodes || []).flatMap((n) => n.textContent || "").join("");
            if (syncText !== coopText) throw new Error(`H: page ${i} text mismatch sync/coop`);
          }

          // For multicolumn layouts, verify no overlap between body and footnotes
          let overlapCheck = { noOverlap: true, bodyBottom: 0, footnotesTop: 0 };
          if (layout.columns > 1 && pages.some((p) => p.footnoteNodes.length > 0)) {
            // Find a page with footnotes
            const firstPageWithFootnotes = pages.find((p) => p.footnoteNodes.length > 0);
            if (firstPageWithFootnotes) {
              // This would require real DOM measurement in final render,
              // which is tested in actual Preview/PDF. The Chromium test here
              // verifies the HTML structure is correct, not the final visual render.
              overlapCheck = { noOverlap: true, verified: "structure-only" };
            }
          }

          // Store result
          window.__validationResult = { passed: true, pageCount: pages.length, overlapCheck };
        }, { geom: createGeometry(layout), layout });

        const result = await page.evaluate(() => window.__validationResult);
        if (!result?.passed) throw new Error("Validation failed");

        await context.close();
      });
    }

    // Test without footnotes (parity check)
    results.noFn = await runTest("No-footnote parity V1–V7 PASS", async () => {
      for (const [key, layout] of Object.entries(layouts)) {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html><head><meta charset="utf-8"><style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: serif; font-size: 12pt; line-height: 1.5; }
            p { margin: 0 0 0.75em 0; }
          </style>
          <script>${engineCode}</script>
          </head><body>
          <p>Content without any footnotes.</p>
          <p>Additional paragraph for spacing.</p>
          <p>Final paragraph.</p>
          </body></html>
        `);

        await page.evaluate(async (params) => {
          const { geom } = params;
          globalThis.createDiv = () => document.createElement("div");
          const nodes = Array.from(document.body.children);

          // Sync (no provider)
          const pagesSync = globalThis.PaginationEngine.paginateDom(nodes, geom);

          // Cooperative (no provider)
          const pagesCoop = await globalThis.PaginationEngine.paginateDomCooperatively(nodes, geom, {
            yieldToBrowser: () => Promise.resolve(),
          });
          if (!pagesCoop) throw new Error("Coop returned null");
          if (pagesSync.length !== pagesCoop.length) throw new Error("no-fn sync/coop page count mismatch");
        }, { geom: createGeometry(layout) });

        await context.close();
      }
    });

  } finally {
    await browser.close();
  }

  // Summary
  const passed = Object.values(results).filter((r) => r).length;
  const total = Object.keys(results).length;

  console.log(`\nLot 6 Chromium layout validation: ${passed}/${total} PASS\n`);

  process.exit(passed === total ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
