#!/usr/bin/env node

/**
 * Lot 4 behavioral tests for reserved bottom area provider.
 * Tests that footnote height properly reserves space during pagination.
 *
 * Run with: node scripts/pagination-reserved-bottom-area-test.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Check Playwright availability
let chromium;
try {
  const { chromium: _chromium } = await import("playwright");
  chromium = _chromium;
} catch (error) {
  console.error("Playwright Chromium not found. Install it with:");
  console.error("  npx playwright install chromium");
  process.exit(1);
}

// Geometry for tests
const geometry = {
  widthPx: 200,
  heightPx: 100,  // Fixed height for deterministic testing
  fontFamily: "Arial, sans-serif",
  fontSizePt: 12,
  lineHeight: 1.5,
  textAlign: "left",
  hyphens: false,
  columnCount: 1,
  css: `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.5; }
    div { margin: 0; }
    .block-a { height: 50px; background: #eee; margin-bottom: 4px; }
    .block-b { height: 40px; background: #f0f0f0; margin-bottom: 4px; }
  `,
};

// Bundle pagination engine
async function bundlePaginationEngine() {
  const result = await build({
    entryPoints: [path.resolve(projectRoot, "src/services/pagination-engine.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    globalName: "PaginationEngine",
    external: [],
  });

  return result.outputFiles[0].text;
}

// Test runner
async function runTest(name, testFn) {
  console.log(`\n• ${name}...`);
  try {
    await testFn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

// Main execution
async function main() {
  console.log("Lot 4: Reserved Bottom Area Behavioral Tests\n");

  const bundleCode = await bundlePaginationEngine();
  const browser = await chromium.launch({ headless: true });

  const results = [];

  try {
    // Test A: Without provider (historical path)
    results.push(
      await runTest("A — Without provider, both blocks fit on 1 page", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Test A</title>
            <style>${geometry.css}</style>
            <script>${bundleCode}</script>
          </head>
          <body>
            <div class="block-a">Block A (50px)</div>
            <div class="block-b">Block B (40px)</div>
          </body>
          </html>
        `);

        const result = await page.evaluate(({ geom }) => {
          globalThis.createDiv = () => document.createElement("div");
          const nodes = Array.from(document.body.children);
          const pages = globalThis.PaginationEngine.paginateDom(nodes, geom);
          return pages.length;
        }, { geom: geometry });

        if (result !== 1) throw new Error(`Expected 1 page, got ${result}`);
        await context.close();
      })
    );

    // Test B: With reserved area (reduces available height)
    results.push(
      await runTest("B — With reserved 30px area, blocks split to 2 pages", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Test B</title>
            <style>${geometry.css}</style>
            <script>${bundleCode}</script>
          </head>
          <body>
            <div class="block-a" data-reserved-note="1">Block A (50px)</div>
            <div class="block-b" data-reserved-note="1">Block B (40px)</div>
          </body>
          </html>
        `);

        const result = await page.evaluate(({ geom }) => {
          globalThis.createDiv = () => document.createElement("div");

          const provider = (bodyNodes) => {
            const hasNotes = Array.from(bodyNodes).some((n) => n.getAttribute?.("data-reserved-note"));
            if (!hasNotes) return null;
            const area = document.createElement("div");
            area.style.height = "30px";
            return area;
          };

          const nodesArray = Array.from(document.body.children);
          const geomWithProvider = { ...geom, reservedBottomAreaProvider: provider };
          const pages = globalThis.PaginationEngine.paginateDom(nodesArray, geomWithProvider);
          return pages.length;
        }, { geom: geometry });

        if (result !== 2) throw new Error(`Expected 2 pages, got ${result}`);
        await context.close();
      })
    );

    // Test C: Two notes reserve more than one note
    results.push(
      await runTest("C — Two notes reserve more space than one note", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Test C</title>
            <style>${geometry.css}</style>
            <script>${bundleCode}</script>
          </head>
          <body>
            <div class="block-a" data-reserved-note="1">Block A (50px)</div>
            <div class="block-b" data-reserved-note="2">Block B (40px)</div>
          </body>
          </html>
        `);

        const result = await page.evaluate(({ geom }) => {
          globalThis.createDiv = () => document.createElement("div");
          const journal = { observedCounts: [] };

          const provider = (bodyNodes) => {
            const noteCount = Array.from(bodyNodes).filter((n) => n.getAttribute?.("data-reserved-note")).length;
            journal.observedCounts.push(noteCount);

            if (noteCount === 0) return null;
            const area = document.createElement("div");
            area.style.height = `${noteCount * 15}px`;  // 15px per note
            return area;
          };

          const nodesArray = Array.from(document.body.children);
          const geomWithProvider = { ...geom, reservedBottomAreaProvider: provider };
          const pages = globalThis.PaginationEngine.paginateDom(nodesArray, geomWithProvider);

          return {
            pageCount: pages.length,
            observed1: journal.observedCounts.includes(1),
            observed2: journal.observedCounts.includes(2),
          };
        }, { geom: geometry });

        if (!result.observed1) throw new Error("Never observed 1 note");
        if (!result.observed2) throw new Error("Never observed 2 notes");
        if (result.pageCount < 2) throw new Error(`Expected at least 2 pages with two notes, got ${result.pageCount}`);
        await context.close();
      })
    );

    // Test D: Rollback — rejected candidate doesn't pollute next page
    results.push(
      await runTest("D — Rejected candidate rollback prevents note pollution", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Test D</title>
            <style>${geometry.css}</style>
            <script>${bundleCode}</script>
          </head>
          <body>
            <div class="block-a" data-reserved-note="1" style="height: 45px;">Block A (45px, note 1)</div>
            <div class="block-b" data-reserved-note="2" style="height: 45px;">Block B (45px, note 2)</div>
          </body>
          </html>
        `);

        const result = await page.evaluate(({ geom }) => {
          globalThis.createDiv = () => document.createElement("div");
          const journal = { idsByAttempt: [] };

          const provider = (bodyNodes) => {
            const ids = Array.from(bodyNodes)
              .filter((n) => n.getAttribute?.("data-reserved-note"))
              .map((n) => n.getAttribute("data-reserved-note"));
            journal.idsByAttempt.push(ids.slice());  // Record this attempt

            if (ids.length === 0) return null;
            const area = document.createElement("div");
            area.style.height = `${ids.length * 15}px`;
            return area;
          };

          const nodesArray = Array.from(document.body.children);
          const geomWithProvider = { ...geom, reservedBottomAreaProvider: provider };
          const pages = globalThis.PaginationEngine.paginateDom(nodesArray, geomWithProvider);

          return {
            pageCount: pages.length,
            hasOnlyNote1: journal.idsByAttempt.some((ids) => JSON.stringify(ids) === '["1"]'),
            hasOnlyNote2: journal.idsByAttempt.some((ids) => JSON.stringify(ids) === '["2"]'),
            hasBoth: journal.idsByAttempt.some((ids) => JSON.stringify(ids) === '["1","2"]'),
          };
        }, { geom: geometry });

        if (result.pageCount < 2) throw new Error(`Expected 2 pages, got ${result.pageCount}`);
        if (!result.hasOnlyNote1) throw new Error("Never observed page with only note 1");
        if (!result.hasOnlyNote2) throw new Error("Never observed page with only note 2");
        await context.close();
      })
    );

    // Test E: Provider returns null (same as no provider)
    results.push(
      await runTest("E — Provider returning null behaves like no provider", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Test E</title>
            <style>${geometry.css}</style>
            <script>${bundleCode}</script>
          </head>
          <body>
            <div class="block-a">Block A (50px)</div>
            <div class="block-b">Block B (40px)</div>
          </body>
          </html>
        `);

        const result = await page.evaluate(({ geom }) => {
          globalThis.createDiv = () => document.createElement("div");

          const provider = () => null;  // Always returns null
          const nodesArray = Array.from(document.body.children);
          const geomWithProvider = { ...geom, reservedBottomAreaProvider: provider };
          const pages = globalThis.PaginationEngine.paginateDom(nodesArray, geomWithProvider);
          return pages.length;
        }, { geom: geometry });

        if (result !== 1) throw new Error(`Expected 1 page (null provider = no reservation), got ${result}`);
        await context.close();
      })
    );

    // Test F: Sync and cooperative produce identical results
    results.push(
      await runTest("F — Sync and cooperative pagination produce identical results", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Test F</title>
            <style>${geometry.css}</style>
            <script>${bundleCode}</script>
          </head>
          <body>
            <div class="block-a" data-reserved-note="1">Block A (50px)</div>
            <div class="block-b" data-reserved-note="1">Block B (40px)</div>
          </body>
          </html>
        `);

        const result = await page.evaluate(async ({ geom }) => {
          globalThis.createDiv = () => document.createElement("div");

          const provider = (bodyNodes) => {
            const hasNotes = Array.from(bodyNodes).some((n) => n.getAttribute?.("data-reserved-note"));
            if (!hasNotes) return null;
            const area = document.createElement("div");
            area.style.height = "30px";
            return area;
          };

          const geomWithProvider = { ...geom, reservedBottomAreaProvider: provider };

          // Sync paginate
          const nodesSync = Array.from(document.body.children);
          const pageSync = globalThis.PaginationEngine.paginateDom(nodesSync, geomWithProvider);
          const syncPageCount = pageSync.length;

          // Cooperative paginate
          const nodesCoop = Array.from(document.body.children);
          const pageCoop = await globalThis.PaginationEngine.paginateDomCooperatively(
            nodesCoop,
            geomWithProvider,
            { yieldToBrowser: () => Promise.resolve() }
          );
          const coopPageCount = pageCoop ? pageCoop.length : 0;

          return {
            syncPages: syncPageCount,
            coopPages: coopPageCount,
            identical: syncPageCount === coopPageCount,
          };
        }, { geom: geometry });

        if (!result.identical) {
          throw new Error(`Sync (${result.syncPages}) != Cooperative (${result.coopPages})`);
        }
        await context.close();
      })
    );

  } finally {
    await browser.close();
  }

  // Summary
  const passed = results.filter((r) => r).length;
  const failed = results.filter((r) => !r).length;

  console.log(`\n═══════════════════════════════════════`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
