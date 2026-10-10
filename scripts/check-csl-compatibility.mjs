import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { chromium } from "playwright";

const { values } = parseArgs({ options: {
  host: { type: "string" }, companion: { type: "string" }, style: { type: "string" },
  "host-kind": { type: "string" }, "companion-kind": { type: "string" },
} });
for (const key of ["host", "companion", "style"]) assert.ok(values[key], `--${key} is required`);
for (const key of ["host-kind", "companion-kind"]) assert.ok(["published", "corrected"].includes(values[key]), `--${key} must be published or corrected`);
const host = resolve(values.host);
const companion = resolve(values.companion);
const xml = readFileSync(values.style, "utf8");
const bundle = await build({
  stdin: { contents: `export { default as CompanionPlugin } from ${JSON.stringify(resolve(companion, "main.ts"))};
    export { CslCitationHost } from ${JSON.stringify(resolve(host, "src/services/csl-citation-host.ts"))};
    export { CitationEngineRegistry, createCitationApi, validateCitationClusterResults } from ${JSON.stringify(resolve(host, "src/api/citation-engine.ts"))};
    export { TFile, TFolder, Plugin } from "obsidian";`, resolveDir: host },
  bundle: true, write: false, format: "iife", globalName: "Compatibility", platform: "browser", loader: { ".xml": "text" },
  external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
  plugins: [{ name: "obsidian-runtime", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve(host, "test/obsidian-runtime-stub.mjs") }));
  } }],
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async ({ xml }) => {
    const api = window.Compatibility;
    const timers = [];
    api.Plugin.prototype.registerInterval = (id) => timers.push(id);
    api.Plugin.prototype.onunload = () => {};
    const root = new api.TFolder("Project");
    const draft = new api.TFolder("Project/Draft");
    const research = new api.TFolder("Project/Research");
    const file = new api.TFile("Project/Draft/Chapter.md", "");
    const bib = new api.TFile("Project/Research/library.bib", "");
    const style = new api.TFile("Project/Research/style.csl", xml);
    root.children = [draft, research]; draft.parent = root; research.parent = root;
    draft.children = [file]; file.parent = draft; research.children = [bib, style];
    bib.parent = research; style.parent = research; style.stat = { mtime: 1, size: xml.length };
    const indexed = new Map([root, draft, research, file, bib, style].map((item) => [item.path, item]));
    const settings = { projectFolder: root.path, projectMeta: { Project: {
      pandocCitationPreviewStyle: "csl", researchFolderLinks: { Project: research.path },
      citekeyBibliographyPath: "library.bib", citekeyCslPath: "style.csl",
    } } };
    const registry = new api.CitationEngineRegistry();
    const citationApi = api.createCitationApi(registry);
    const app = { plugins: { plugins: { feuillets: { api: { citations: citationApi } } } },
      workspace: { onLayoutReady: (callback) => callback(), getLeavesOfType: () => [] },
      metadataCache: { getFileCache: () => ({}) },
      vault: { getAbstractFileByPath: (path) => indexed.get(path), cachedRead: async (item) => item.content, read: async (item) => item.content } };
    const plugin = new api.CompanionPlugin(app, { version: "test" });
    plugin.onload();
    const provider = registry.get("feuillets-csl");
    const registered = provider === plugin.getProvider() && plugin.isConnected();
    const host = new api.CslCitationHost({ app, settings, citationRegistry: registry });
    const valid = "@book{valid,title={Independent Study},author={Example, Alice},year={2024}}";
    const unsupported = "@typefutur2027{problem,title={Unsupported}}";
    const duplicates = "@book{problem,title={First}}@book{problem,title={Second}}";
    const cyclic = "@book{problem,title={Cycle Alpha},crossref={parent}}@book{parent,title={Cycle Beta},year={2020},crossref={problem}}";
    const cases = [
      { name: "valid", content: valid, keys: [["valid"]] },
      { name: "unsupported-unused", content: valid + unsupported, keys: [["valid"]] },
      { name: "unsupported-cited", content: valid + unsupported, keys: [["valid"], ["problem"], ["valid", "problem"]] },
      { name: "duplicate-unused", content: valid + duplicates, keys: [["valid"]] },
      { name: "duplicate-cited", content: valid + duplicates, keys: [["valid"], ["problem"], ["valid", "problem"]] },
      { name: "cycle-unused", content: valid + cyclic, keys: [["valid"]] },
      { name: "cycle-cited", content: valid + cyclic, keys: [["valid"], ["problem"], ["valid", "problem"]] },
      { name: "unknown", content: valid, keys: [["valid"], ["missing"], ["valid", "missing"]] },
    ];
    const observations = [];
    for (let index = 0; index < cases.length; index++) {
      const scenario = cases[index];
      bib.content = scenario.content; bib.stat = { mtime: index + 1, size: bib.content.length };
      file.content = scenario.keys.map((ids) => `[${ids.map((key) => `@${key}`).join("; ")}]`).join("\n\n");
      host.invalidateResource(bib.path);
      const clusters = scenario.keys.map((ids, i) => ({ id: `c${i}`, items: ids.map((id) => ({ id })), noteIndex: i + 1 }));
      const request = { documentId: `direct-${index}`, revision: 1, style: { id: style.path, version: "1", xml },
        bibliographies: [{ id: bib.path, version: String(index + 1), format: "bibtex", content: bib.content }],
        locale: "en-US", includeBibliography: true, clusters };
      const direct = await provider.renderDocument(request);
      const validation = api.validateCitationClusterResults(clusters, direct);
      const snapshot = await host.renderDocument(`host-${index}`, file.content, root, file);
      observations.push({ name: scenario.name, directCitations: direct.citations.map((item) => item.clusterId),
        independentRendered: direct.citations.some((item) => item.clusterId === "c0" && item.plainText.includes("Independent Study")),
        contractAccepted: validation.valid, hostStatus: snapshot.status, hostCitations: snapshot.result?.citations.length ?? 0,
        diagnostics: direct.diagnostics.map((d) => ({ code: d.code, severity: d.severity, clusterId: d.clusterId ?? null })),
        cyclicMetadataRendered: scenario.name === "cycle-cited" && direct.citations.some((item) => item.plainText.includes("Cycle Beta")),
        explicitHostError: snapshot.status !== "engine-error" || Boolean(snapshot.reason) });
    }
    host.dispose(); plugin.onunload(); timers.forEach(clearInterval);
    return { registered, apiVersion: citationApi.apiVersion, observations };
  }, { xml });
  assert.equal(result.registered, true);
  assert.equal(result.apiVersion, 2);
  for (const observation of result.observations) {
    const oldCompanion = values["companion-kind"] === "published";
    const oldHost = values["host-kind"] === "published";
    const libraryFailure = oldCompanion && /^(unsupported|duplicate)-/.test(observation.name);
    const recoveredEntry = !oldCompanion && /^(unsupported|duplicate|cycle)-cited$/.test(observation.name);
    const rejectedByHost = libraryFailure || (oldHost && recoveredEntry);
    assert.equal(observation.independentRendered, !libraryFailure, observation.name);
    assert.equal(observation.contractAccepted, !rejectedByHost, observation.name);
    assert.equal(observation.hostStatus, rejectedByHost ? "engine-error" : "ready", observation.name);
    assert.equal(observation.explicitHostError, true, observation.name);
    const directCount = libraryFailure ? 0 : observation.name === "cycle-cited" && oldCompanion ? 3 : 1;
    assert.equal(observation.directCitations.length, directCount, observation.name);
    assert.equal(observation.hostCitations, rejectedByHost ? 0 : directCount, observation.name);
    assert.equal(observation.cyclicMetadataRendered, observation.name === "cycle-cited" && oldCompanion, observation.name);
  }
  console.log(JSON.stringify({ host: values["host-kind"], companion: values["companion-kind"], ...result }, null, 2));
} finally {
  await browser.close();
}
