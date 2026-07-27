import { mkdir, readFile, writeFile } from "node:fs/promises";

const targetDir = ".test-dist/node_modules/obsidian";
const stub = await readFile("test/obsidian-runtime-stub.mjs", "utf8");

await mkdir(targetDir, { recursive: true });
await writeFile(`${targetDir}/package.json`, JSON.stringify({ type: "module" }));
await writeFile(`${targetDir}/index.js`, stub);
