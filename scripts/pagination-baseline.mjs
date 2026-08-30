#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Determine mode
const updateMode = process.argv.includes("--update");

// Paths
const fixtureHtmlPath = path.resolve(projectRoot, "test/fixtures/pagination-baseline.html");
const baselineJsonPath = path.resolve(projectRoot, "test/fixtures/pagination-baseline.json");

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

// Geometry matching the specification
const geometry = {
  widthPx: 160 / 25.4 * 96,  // 604.72px
  heightPx: 247 / 25.4 * 96, // 933.54px
  fontFamily: "Arial, sans-serif",
  fontSizePt: 12,
  lineHeight: 1.5,
  textAlign: "justify",
  hyphens: false,
  columnCount: 1,
  css: `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; }
    p { margin: 0.5em 0; text-indent: 1.5em; }
    p:first-of-type { text-indent: 0; }
    h3 { margin: 0.5em 0 0.25em 0; font-size: 1.2em; }
  `,
};

// Bundle pagination-engine.ts
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

  const bundleCode = result.outputFiles[0].text;
  return bundleCode;
}

// Calculate SHA-256 hash
function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// Extract nodes and run pagination
async function runPaginationTest(page, bundleCode) {
  return await page.evaluate(
    async ({ bundleCode, geometryData, fixtureHtmlContent }) => {
      // Define createDiv helper for pagination engine
      globalThis.createDiv = () => document.createElement("div");

      // Inject bundle
      const script = document.createElement("script");
      script.textContent = bundleCode;
      document.head.appendChild(script);

      // Wait for fonts
      await document.fonts.ready;

      // Collect nodes to paginate (all direct children of body except scripts/styles)
      const nodes = Array.from(document.body.children).filter((n) => {
        const tag = n.tagName.toLowerCase();
        return tag !== "script" && tag !== "style";
      });

      // Run pagination
      const pages = globalThis.PaginationEngine.paginateDom(nodes, geometryData);

      // Compute source text for integrity check
      const sourceText = nodes.map((n) => n.textContent || "").join("");

      // Extract page data
      const pageData = pages.map((pageNodes, pageIndex) => {
        const pageText = pageNodes.map((n) => n.textContent || "").join("");
        const pageHtml = pageNodes.map((n) => n.outerHTML).join("");
        return {
          page: pageIndex + 1,
          text: pageText,
          htmlHash: globalThis.PaginationEngine.sha256(pageHtml) || null,
        };
      });

      // Compute total paginated text
      const paginatedText = pageData.map((p) => p.text).join("");

      return {
        sourceText,
        paginatedText,
        pageCount: pages.length,
        pages: pageData,
      };
    },
    { bundleCode, geometryData: geometry, fixtureHtmlContent: "" }
  );
}

// Compute SHA256 in Node for verification
function computePageHash(pageNodes) {
  const html = pageNodes.map((n) => n.outerHTML).join("");
  return sha256(html);
}

// Main execution
async function main() {
  try {
    // Check fixture exists
    if (!fs.existsSync(fixtureHtmlPath)) {
      console.error(`Fixture not found: ${fixtureHtmlPath}`);
      process.exit(1);
    }

    // Bundle the pagination engine
    console.log("Bundling pagination engine...");
    const bundleCode = await bundlePaginationEngine();

    // Launch browser
    console.log("Launching Chromium...");
    const browser = await chromium.launch();

    try {
      const context = await browser.newContext({
        viewport: { width: 1024, height: 768 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      // Load fixture
      const fixtureHtml = fs.readFileSync(fixtureHtmlPath, "utf8");
      await page.setContent(fixtureHtml);

      // Inject bundle and run pagination
      console.log("Running pagination...");
      const result = await page.evaluate(
        async ({ bundleCode, geometryData }) => {
          // Define createDiv helper
          globalThis.createDiv = () => document.createElement("div");

          // Inject bundle
          const script = document.createElement("script");
          script.textContent = bundleCode;
          document.head.appendChild(script);

          // Wait for fonts
          await document.fonts.ready;

          // Collect nodes (all body children except scripts/styles)
          const nodes = Array.from(document.body.children).filter((n) => {
            const tag = n.tagName.toLowerCase();
            return tag !== "script" && tag !== "style";
          });

          // Extract source text for integrity check
          const sourceText = nodes.map((n) => n.textContent || "").join("");

          // Call pagination engine
          const pages = globalThis.PaginationEngine.paginateDom(nodes, geometryData);

          // Build result - return HTML for hashing in Node
          return {
            sourceText,
            pageCount: pages.length,
            pages: pages.map((page, idx) => {
              const pageNodes = page.bodyNodes;
              const pageText = pageNodes.map((n) => n.textContent || "").join("");
              const pageHtml = pageNodes.map((n) => n.outerHTML).join("");
              return {
                page: idx + 1,
                text: pageText,
                html: pageHtml,
                bodyNodesLength: pageNodes.length,
                footnoteNodesLength: page.footnoteNodes.length,
              };
            }),
          };
        },
        { bundleCode, geometryData: geometry }
      );

      // Compute hashes in Node and verify structure
      result.pages = result.pages.map((pageData) => {
        // Verify page structure (Lot 1: bodyNodes present, footnoteNodes empty)
        if (pageData.bodyNodesLength === undefined || pageData.footnoteNodesLength === undefined) {
          console.error(`Page structure verification failed`);
          process.exit(1);
        }
        if (pageData.footnoteNodesLength !== 0) {
          console.error(`Page ${pageData.page}: footnoteNodes should be empty in Lot 1`);
          process.exit(1);
        }
        return {
          page: pageData.page,
          text: pageData.text,
          htmlHash: sha256(pageData.html),
        };
      });

      // Verify integrity - strict equality, no normalization
      const paginatedText = result.pages.map((p) => p.text).join("");
      if (result.sourceText !== paginatedText) {
        console.error("CONTENT INTEGRITY FAILURE");
        console.error("Source text length:", result.sourceText.length);
        console.error("Paginated text length:", paginatedText.length);
        console.error("Source ends with:", result.sourceText.slice(-60));
        console.error("Paginated ends with:", paginatedText.slice(-60));
        process.exit(1);
      }

      // Verify page count
      if (result.pageCount < 5 || result.pageCount > 10) {
        console.error(`INVALID PAGE COUNT: ${result.pageCount}`);
        console.error("Expected: 5–10 pages");
        process.exit(1);
      }

      console.log(`✓ Pagination complete: ${result.pageCount} pages`);
      console.log(`✓ Content integrity verified`);

      if (updateMode) {
        // Save baseline
        const baseline = {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          geometry,
          pageCount: result.pageCount,
          pages: result.pages,
        };
        fs.writeFileSync(baselineJsonPath, JSON.stringify(baseline, null, 2));
        console.log(`✓ Baseline updated: ${result.pageCount} pages`);
      } else {
        // Compare with baseline
        if (!fs.existsSync(baselineJsonPath)) {
          console.error(
            "Baseline not found. Create it with: npm run update:pagination-baseline"
          );
          process.exit(1);
        }

        const baseline = JSON.parse(fs.readFileSync(baselineJsonPath, "utf8"));

        // Compare page count
        if (baseline.pageCount !== result.pageCount) {
          console.error("PAGINATION REGRESSION");
          console.error(`Expected pages: ${baseline.pageCount}`);
          console.error(`Received pages: ${result.pageCount}`);
          process.exit(1);
        }

        // Compare pages
        let firstDifferentPage = -1;
        for (let i = 0; i < baseline.pages.length; i++) {
          const expected = baseline.pages[i];
          const received = result.pages[i];

          if (expected.text !== received.text || expected.htmlHash !== received.htmlHash) {
            firstDifferentPage = i + 1;
            console.error("PAGINATION REGRESSION");
            console.error(`Expected pages: ${baseline.pageCount}`);
            console.error(`Received pages: ${result.pageCount}`);
            console.error(`First different page: ${firstDifferentPage}`);

            const expectedEnd = expected.text.slice(-120).replace(/\n/g, " ");
            const receivedEnd = received.text.slice(-120).replace(/\n/g, " ");
            console.error(`Expected end: "${expectedEnd}"`);
            console.error(`Received end: "${receivedEnd}"`);
            console.error(`Expected hash: ${expected.htmlHash}`);
            console.error(`Received hash: ${received.htmlHash}`);
            process.exit(1);
          }
        }

        console.log(`✓ Pagination baseline unchanged`);
        console.log(`✓ ${result.pageCount} pages`);
        console.log(`✓ Pages 1–${result.pageCount} identical`);
      }

      await context.close();
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
