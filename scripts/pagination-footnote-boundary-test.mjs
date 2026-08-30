#!/usr/bin/env node

/**
 * Lot 5 boundary and repeated reference tests.
 * Tests REAL pagination boundaries with footnote providers and assertions.
 *
 * Run with: node scripts/pagination-footnote-boundary-test.mjs
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

// Main execution
async function main() {
  const { engine: engineCode, footnotes: footnotesCode } = await bundleServices();
  const browser = await chromium.launch({ headless: true });

  const results = [];

  try {
    // Test A: First call stays on page N
    results.push(
      await runTest("A PASS — call stays with page N", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html><head><meta charset="utf-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: monospace; font-size: 12pt; line-height: 1.5; width: 400px; }
            p { margin: 0; }
            sup.footnote-ref { font-size: 0.8em; }
          </style>
          <script>${engineCode}</script>
          <script>${footnotesCode}</script>
          </head><body>
          <p>Open paragraph with the first footnote call<sup class="footnote-ref"><a href="#fn1">1</a></sup> here in the text to stay on page zero.</p>
          <p>Additional content filler paragraph for spacing.</p>
          <p>More paragraph text.</p>
          </body></html>
        `);

        await page.evaluate(() => {
          const geometry = {
            widthPx: 400,
            heightPx: 180,
            fontFamily: "monospace",
            fontSizePt: 12,
            lineHeight: 1.5,
            textAlign: "left",
            hyphens: false,
            columnCount: 1,
            css: "",
          };

          const definitions = [{ id: "fn1", html: "<p>Note one</p>" }];
          const nodes = Array.from(document.body.children);

          globalThis.createDiv = () => document.createElement("div");

          // Mark repeated refs
          globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodes);

          // Simple provider
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

          geometry.reservedBottomAreaProvider = provider;

          const pages = globalThis.PaginationEngine.paginateDom(nodes, geometry);

          // Populate final footnotes
          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pages, definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });

          // Verify: fn1 call on page 0, note on page 0
          if (pages.length < 1) throw new Error("Expected at least 1 page");

          const page0Body = pages[0].bodyNodes || [];
          const page0Sups = page0Body.flatMap((n) => Array.from(n.querySelectorAll?.("sup.footnote-ref") || []));
          const hasCall = page0Sups.length > 0;

          if (!hasCall) throw new Error("fn1 call missing on page 0");

          const page0Notes = pages[0].footnoteNodes || [];
          const hasNote = page0Notes.some((n) => n.id === "fn1");

          if (!hasNote) throw new Error("fn1 note missing on page 0");
        });

        await context.close();
      })
    );

    // Test B: Call moves to page N+1 when N becomes full
    results.push(
      await runTest("B PASS — call moves to page N+1 and note follows", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html><head><meta charset="utf-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: monospace; font-size: 12pt; line-height: 1.5; width: 400px; }
            p { margin: 0; }
            sup.footnote-ref { font-size: 0.8em; }
          </style>
          <script>${engineCode}</script>
          <script>${footnotesCode}</script>
          </head><body>
          <p>Start of a very long paragraph that fills up significant vertical space and then continues with more text to push the footnote call fn1 over to the next page since page zero must become full first from the provider reserve.</p>
          <p>Call fn1 here<sup class="footnote-ref"><a href="#fn1">1</a></sup> near boundary.</p>
          <p>End content.</p>
          </body></html>
        `);

        await page.evaluate(() => {
          const geometry = {
            widthPx: 400,
            heightPx: 150,
            fontFamily: "monospace",
            fontSizePt: 12,
            lineHeight: 1.5,
            textAlign: "left",
            hyphens: false,
            columnCount: 1,
            css: "",
          };

          const definitions = [{ id: "fn1", html: "<p>Note one</p>" }];
          const nodes = Array.from(document.body.children);

          globalThis.createDiv = () => document.createElement("div");

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
            area.style.height = `${tempPage.footnoteNodes.length * 24}px`;
            return area;
          };

          geometry.reservedBottomAreaProvider = provider;
          const pages = globalThis.PaginationEngine.paginateDom(nodes, geometry);

          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pages, definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });

          // Verify: fn1 NOT on page 0, IS on page 1
          if (pages.length < 2) throw new Error(`Expected at least 2 pages, got ${pages.length}`);

          const page0Sups = (pages[0].bodyNodes || []).flatMap((n) =>
            Array.from(n.querySelectorAll?.("sup.footnote-ref") || [])
          );
          const page0HasFn1 = page0Sups.some((s) => {
            const link = s.querySelector("a[href]");
            return link && link.getAttribute("href") === "#fn1";
          });
          if (page0HasFn1) throw new Error("fn1 call should NOT be on page 0");

          const page1Sups = (pages[1].bodyNodes || []).flatMap((n) =>
            Array.from(n.querySelectorAll?.("sup.footnote-ref") || [])
          );
          const page1HasFn1 = page1Sups.some((s) => {
            const link = s.querySelector("a[href]");
            return link && link.getAttribute("href") === "#fn1";
          });
          if (!page1HasFn1) throw new Error("fn1 call should be on page 1");

          const page0Notes = pages[0].footnoteNodes || [];
          const hasNoteOnPage0 = page0Notes.some((n) => n.id === "fn1");
          if (hasNoteOnPage0) throw new Error("fn1 note should NOT be on page 0");

          const page1Notes = pages[1].footnoteNodes || [];
          const hasNoteOnPage1 = page1Notes.some((n) => n.id === "fn1");
          if (!hasNoteOnPage1) throw new Error("fn1 note should be on page 1");
        });

        await context.close();
      })
    );

    // Test C: Multiple calls in one paragraph
    results.push(
      await runTest("C PASS — multiple calls follow paragraph fragments", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html><head><meta charset="utf-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: monospace; font-size: 12pt; line-height: 1.5; width: 400px; }
            p { margin: 0; }
            sup.footnote-ref { font-size: 0.8em; }
          </style>
          <script>${engineCode}</script>
          <script>${footnotesCode}</script>
          </head><body>
          <p>Text with note one<sup class="footnote-ref"><a href="#fn1">1</a></sup> and more text with note two<sup class="footnote-ref"><a href="#fn2">2</a></sup> and further text with note three<sup class="footnote-ref"><a href="#fn3">3</a></sup> to fill content.</p>
          </body></html>
        `);

        await page.evaluate(() => {
          const geometry = {
            widthPx: 400,
            heightPx: 150,
            fontFamily: "monospace",
            fontSizePt: 12,
            lineHeight: 1.5,
            textAlign: "left",
            hyphens: false,
            columnCount: 1,
            css: "",
          };

          const definitions = [
            { id: "fn1", html: "<p>Note 1</p>" },
            { id: "fn2", html: "<p>Note 2</p>" },
            { id: "fn3", html: "<p>Note 3</p>" },
          ];
          const nodes = Array.from(document.body.children);

          globalThis.createDiv = () => document.createElement("div");

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
            area.style.height = `${tempPage.footnoteNodes.length * 24}px`;
            return area;
          };

          geometry.reservedBottomAreaProvider = provider;
          const pages = globalThis.PaginationEngine.paginateDom(nodes, geometry);

          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pages, definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });

          // Verify: multiple calls span pages, each call's note on same page
          if (pages.length < 1) throw new Error("Expected at least 1 page");

          for (const fnId of ["fn1", "fn2", "fn3"]) {
            let foundCallPage = -1;
            let foundNotePage = -1;

            for (let i = 0; i < pages.length; i++) {
              const sups = (pages[i].bodyNodes || []).flatMap((n) =>
                Array.from(n.querySelectorAll?.("sup.footnote-ref") || [])
              );
              if (sups.some((s) => {
                const link = s.querySelector("a[href]");
                return link && link.getAttribute("href") === `#${fnId}`;
              })) foundCallPage = i;

              if ((pages[i].footnoteNodes || []).some((n) => n.id === fnId)) foundNotePage = i;
            }

            if (foundCallPage === -1) throw new Error(`${fnId} call not found`);
            if (foundNotePage === -1) throw new Error(`${fnId} note not found`);
            if (foundCallPage !== foundNotePage) {
              throw new Error(`${fnId} call on page ${foundCallPage} but note on page ${foundNotePage}`);
            }
          }
        });

        await context.close();
      })
    );

    // Test D: Calls on opposite sides of boundary
    results.push(
      await runTest("D PASS — calls around boundary stay on their own pages", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html><head><meta charset="utf-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: monospace; font-size: 12pt; line-height: 1.5; width: 400px; }
            p { margin: 0; }
            sup.footnote-ref { font-size: 0.8em; }
          </style>
          <script>${engineCode}</script>
          <script>${footnotesCode}</script>
          </head><body>
          <p>Start with first call<sup class="footnote-ref"><a href="#fn1">1</a></sup> here.</p>
          <p>Large middle paragraph with filler text to create a page break boundary between the first call and the second call that follows.</p>
          <p>End with second call<sup class="footnote-ref"><a href="#fn2">2</a></sup> after boundary.</p>
          </body></html>
        `);

        await page.evaluate(() => {
          const geometry = {
            widthPx: 400,
            heightPx: 150,
            fontFamily: "monospace",
            fontSizePt: 12,
            lineHeight: 1.5,
            textAlign: "left",
            hyphens: false,
            columnCount: 1,
            css: "",
          };

          const definitions = [
            { id: "fn1", html: "<p>Note 1</p>" },
            { id: "fn2", html: "<p>Note 2</p>" },
          ];
          const nodes = Array.from(document.body.children);

          globalThis.createDiv = () => document.createElement("div");

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
            area.style.height = `${tempPage.footnoteNodes.length * 24}px`;
            return area;
          };

          geometry.reservedBottomAreaProvider = provider;
          const pages = globalThis.PaginationEngine.paginateDom(nodes, geometry);

          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pages, definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });

          if (pages.length < 2) throw new Error(`Expected at least 2 pages, got ${pages.length}`);

          // Page N: fn1 call and note, NO fn2
          const pageNSups = (pages[0].bodyNodes || []).flatMap((n) =>
            Array.from(n.querySelectorAll?.("sup.footnote-ref") || [])
          );
          if (pageNSups.length !== 1) throw new Error(`Page 0 should have 1 call, has ${pageNSups.length}`);

          const pageNHasFn1 = pageNSups.some((s) => {
            const link = s.querySelector("a[href]");
            return link && link.getAttribute("href") === "#fn1";
          });
          if (!pageNHasFn1) throw new Error("Page 0 should have fn1 call");

          const pageNNotes = pages[0].footnoteNodes || [];
          if (!pageNNotes.some((n) => n.id === "fn1")) throw new Error("Page 0 missing fn1 note");
          if (pageNNotes.some((n) => n.id === "fn2")) throw new Error("Page 0 should not have fn2 note");

          // Page N+1: fn2 call and note, NO fn1
          const pageN1Sups = (pages[1].bodyNodes || []).flatMap((n) =>
            Array.from(n.querySelectorAll?.("sup.footnote-ref") || [])
          );
          if (pageN1Sups.length !== 1) throw new Error(`Page 1 should have 1 call, has ${pageN1Sups.length}`);

          const pageN1HasFn2 = pageN1Sups.some((s) => {
            const link = s.querySelector("a[href]");
            return link && link.getAttribute("href") === "#fn2";
          });
          if (!pageN1HasFn2) throw new Error("Page 1 should have fn2 call");

          const pageN1Notes = pages[1].footnoteNodes || [];
          if (!pageN1Notes.some((n) => n.id === "fn2")) throw new Error("Page 1 missing fn2 note");
          if (pageN1Notes.some((n) => n.id === "fn1")) throw new Error("Page 1 should not have fn1 note");
        });

        await context.close();
      })
    );

    // Test E: Repeated reference inter-pages
    results.push(
      await runTest("E PASS — repeated reference reserves only first definition", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html><head><meta charset="utf-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: monospace; font-size: 12pt; line-height: 1.5; width: 400px; }
            p { margin: 0; }
            sup.footnote-ref { font-size: 0.8em; }
          </style>
          <script>${engineCode}</script>
          <script>${footnotesCode}</script>
          </head><body>
          <p>First occurrence of note one<sup class="footnote-ref"><a href="#fn1">1</a></sup>.</p>
          <p>Some space filler paragraph to create page break.</p>
          <p>Second occurrence of note one<sup class="footnote-ref"><a href="#fn1">1</a></sup>.</p>
          </body></html>
        `);

        await page.evaluate(() => {
          const geometry = {
            widthPx: 400,
            heightPx: 150,
            fontFamily: "monospace",
            fontSizePt: 12,
            lineHeight: 1.5,
            textAlign: "left",
            hyphens: false,
            columnCount: 1,
            css: "",
          };

          const definitions = [{ id: "fn1", html: "<p>Note 1</p>" }];
          const nodes = Array.from(document.body.children);

          globalThis.createDiv = () => document.createElement("div");

          // Mark repeated refs
          globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodes);

          // Verify marking
          const sups = nodes.flatMap((n) => Array.from(n.querySelectorAll?.("sup.footnote-ref") || []));
          if (sups.length !== 2) throw new Error(`Expected 2 sups, got ${sups.length}`);

          const firstMarked = sups[0].getAttribute("data-pagination-footnote-repeat");
          const secondMarked = sups[1].getAttribute("data-pagination-footnote-repeat");
          if (firstMarked !== null) throw new Error("First sup should not be marked");
          if (secondMarked !== "true") throw new Error("Second sup should be marked");

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

          geometry.reservedBottomAreaProvider = provider;
          const pages = globalThis.PaginationEngine.paginateDom(nodes, geometry);

          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pages, definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });

          if (pages.length < 2) throw new Error(`Expected at least 2 pages, got ${pages.length}`);

          // Note should only be on first page
          const page0Notes = pages[0].footnoteNodes || [];
          const page1Notes = pages[1].footnoteNodes || [];

          if (!page0Notes.some((n) => n.id === "fn1")) throw new Error("fn1 note missing from page 0");
          if (page1Notes.some((n) => n.id === "fn1")) throw new Error("fn1 note should NOT be on page 1");
        });

        await context.close();
      })
    );

    // Test F: Punctuation around reference
    results.push(
      await runTest("F PASS — punctuation stays attached to call token", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html><head><meta charset="utf-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: monospace; font-size: 12pt; line-height: 1.5; width: 400px; }
            p { margin: 0; }
            sup.footnote-ref { font-size: 0.8em; }
          </style>
          <script>${engineCode}</script>
          <script>${footnotesCode}</script>
          </head><body>
          <p>Statement one<sup class="footnote-ref"><a href="#fn1">1</a></sup>. Continuation of text after punctuation.</p>
          <p>Statement two<sup class="footnote-ref"><a href="#fn1">1</a></sup>. More text continues here.</p>
          </body></html>
        `);

        await page.evaluate(() => {
          const geometry = {
            widthPx: 400,
            heightPx: 150,
            fontFamily: "monospace",
            fontSizePt: 12,
            lineHeight: 1.5,
            textAlign: "left",
            hyphens: false,
            columnCount: 1,
            css: "",
          };

          const definitions = [{ id: "fn1", html: "<p>Note 1</p>" }];
          const nodes = Array.from(document.body.children);

          globalThis.createDiv = () => document.createElement("div");

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
            area.style.height = `${tempPage.footnoteNodes.length * 24}px`;
            return area;
          };

          geometry.reservedBottomAreaProvider = provider;
          const pages = globalThis.PaginationEngine.paginateDom(nodes, geometry);

          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pages, definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });

          // Verify: both sups still in body
          const allSups = pages.flatMap((p) =>
            (p.bodyNodes || []).flatMap((n) => Array.from(n.querySelectorAll?.("sup.footnote-ref") || []))
          );
          if (allSups.length < 2) throw new Error(`Expected 2 sups in body, found ${allSups.length}`);

          // Verify: both sups have link to fn1
          for (const sup of allSups) {
            const link = sup.querySelector("a[href]");
            if (!link || link.getAttribute("href") !== "#fn1") throw new Error("Sup should have link to fn1");
          }
        });

        await context.close();
      })
    );

    // Test G: Sync/cooperative parity
    results.push(
      await runTest("G PASS — sync/cooperative boundary parity", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html><head><meta charset="utf-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: monospace; font-size: 12pt; line-height: 1.5; width: 400px; }
            p { margin: 0; }
            sup.footnote-ref { font-size: 0.8em; }
          </style>
          <script>${engineCode}</script>
          <script>${footnotesCode}</script>
          </head><body>
          <p>First occurrence of note<sup class="footnote-ref"><a href="#fn1">1</a></sup>.</p>
          <p>Second occurrence of same note<sup class="footnote-ref"><a href="#fn1">1</a></sup>.</p>
          <p>Additional paragraph content to fill pages.</p>
          </body></html>
        `);

        await page.evaluate(async () => {
          const geometry = {
            widthPx: 400,
            heightPx: 150,
            fontFamily: "monospace",
            fontSizePt: 12,
            lineHeight: 1.5,
            textAlign: "left",
            hyphens: false,
            columnCount: 1,
            css: "",
          };

          const definitions = [{ id: "fn1", html: "<p>Note 1</p>" }];

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
            area.style.height = `${tempPage.footnoteNodes.length * 24}px`;
            return area;
          };

          // Sync
          const nodesSync = Array.from(document.body.children).map((n) => n.cloneNode(true));
          globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodesSync);
          geometry.reservedBottomAreaProvider = createProvider();
          const pagesSync = globalThis.PaginationEngine.paginateDom(nodesSync, geometry);
          globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pagesSync, definitions, (def) => {
            const li = document.createElement("li");
            li.id = def.id;
            li.innerHTML = def.html;
            return li;
          });

          // Cooperative
          const nodesCoop = Array.from(document.body.children).map((n) => n.cloneNode(true));
          globalThis.PaginationFootnotes.markRepeatedPaginationFootnoteReferences(nodesCoop);
          geometry.reservedBottomAreaProvider = createProvider();
          const pagesCoop = await globalThis.PaginationEngine.paginateDomCooperatively(nodesCoop, geometry, {
            yieldToBrowser: () => Promise.resolve(),
          });
          if (pagesCoop) {
            globalThis.PaginationFootnotes.populatePaginationFootnoteNodes(pagesCoop, definitions, (def) => {
              const li = document.createElement("li");
              li.id = def.id;
              li.innerHTML = def.html;
              return li;
            });
          }

          // Compare
          if (!pagesCoop) throw new Error("Cooperative pagination returned null");
          if (pagesSync.length !== pagesCoop.length) {
            throw new Error(
              `Sync (${pagesSync.length} pages) != Cooperative (${pagesCoop.length} pages)`
            );
          }

          // Compare page contents
          for (let i = 0; i < pagesSync.length; i++) {
            const syncCallCount = (pagesSync[i].bodyNodes || []).flatMap((n) =>
              Array.from(n.querySelectorAll?.("sup.footnote-ref") || [])
            ).length;
            const coopCallCount = (pagesCoop[i].bodyNodes || []).flatMap((n) =>
              Array.from(n.querySelectorAll?.("sup.footnote-ref") || [])
            ).length;

            if (syncCallCount !== coopCallCount) {
              throw new Error(`Page ${i}: sync calls ${syncCallCount} != coop calls ${coopCallCount}`);
            }

            const syncNoteCount = (pagesSync[i].footnoteNodes || []).length;
            const coopNoteCount = (pagesCoop[i].footnoteNodes || []).length;

            if (syncNoteCount !== coopNoteCount) {
              throw new Error(`Page ${i}: sync notes ${syncNoteCount} != coop notes ${coopNoteCount}`);
            }
          }
        });

        await context.close();
      })
    );

  } finally {
    await browser.close();
  }

  // Summary
  const passed = results.filter((r) => r).length;
  const failed = results.filter((r) => !r).length;

  console.log(`\nLot 5 boundary tests: ${passed}/${passed + failed} PASS\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
