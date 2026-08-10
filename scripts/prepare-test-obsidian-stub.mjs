import { mkdir, readFile, writeFile } from "node:fs/promises";

const targetDir = ".test-dist/node_modules/obsidian";
const stub = await readFile("test/obsidian-runtime-stub.mjs", "utf8");

await mkdir(targetDir, { recursive: true });
await writeFile(`${targetDir}/package.json`, JSON.stringify({ type: "module" }));
await writeFile(`${targetDir}/index.js`, stub);

for (const name of ["state", "view", "language"]) {
  const codemirrorDir = `.test-dist/node_modules/@codemirror/${name}`;
  const codemirrorStub = await readFile(`test/codemirror-${name}-stub.mjs`, "utf8");
  await mkdir(codemirrorDir, { recursive: true });
  await writeFile(`${codemirrorDir}/package.json`, JSON.stringify({ type: "module" }));
  await writeFile(`${codemirrorDir}/index.js`, codemirrorStub);
}
