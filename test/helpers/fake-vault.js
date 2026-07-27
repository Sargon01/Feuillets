import { TFile, TFolder, normalizePath } from "obsidian";

export function createFakeVault(entries = []) {
  const files = new Map();
  for (const entry of entries) files.set(entry.path, entry);

  const vault = {
    getAbstractFileByPath(path) {
      return files.get(normalizePath(path)) || null;
    },
    async read(file) {
      return file.content || "";
    },
    async create(path, content) {
      const file = new TFile(normalizePath(path), content);
      files.set(file.path, file);
      return file;
    },
    async modify(file, content) {
      file.content = content;
    },
  };

  const fileManager = {
    async renameFile(file, path) {
      files.delete(file.path);
      file.path = normalizePath(path);
      file.name = file.path.split("/").pop();
      file.basename = file.name.replace(/\.md$/, "");
      files.set(file.path, file);
    },
    async processFrontMatter(file, callback) {
      const match = (file.content || "").match(/^---\n([\s\S]*?)\n---\n?/);
      const frontmatter = {};
      for (const line of match?.[1].split("\n") || []) {
        const [key, value = ""] = line.split(/:\s*/, 2);
        if (key) frontmatter[key] = value;
      }
      callback(frontmatter);
    },
  };

  return { vault, fileManager, files, TFolder };
}
