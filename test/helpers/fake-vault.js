import { TFile, TFolder, normalizePath } from "obsidian";

export function createFakeVault(entries = []) {
  const files = new Map();
  for (const entry of entries) files.set(entry.path, entry);

  const parentFolder = (path) => files.get(normalizePath(path).split("/").slice(0, -1).join("/"));
  const addFile = (path, content) => {
    const file = new TFile(normalizePath(path), content);
    file.parent = parentFolder(file.path) || null;
    file.stat = { mtime: Date.now() };
    files.set(file.path, file);
    if (file.parent?.children) file.parent.children.push(file);
    return file;
  };

  const vault = {
    getAbstractFileByPath(path) {
      return files.get(normalizePath(path)) || null;
    },
    async read(file) {
      return file.content || "";
    },
    async create(path, content) {
      return addFile(path, content);
    },
    async copy(file, path) {
      return addFile(path, file.content || "");
    },
    async createFolder(path) {
      const folder = new TFolder(normalizePath(path));
      folder.parent = parentFolder(folder.path) || null;
      files.set(folder.path, folder);
      if (folder.parent?.children) folder.parent.children.push(folder);
      return folder;
    },
    async modify(file, content) {
      file.content = content;
    },
    async readBinary(file) {
      return file.content || "";
    },
    async createBinary(path, content) {
      return addFile(path, content);
    },
    async delete(file) {
      files.delete(file.path);
      if (file.parent?.children) file.parent.children = file.parent.children.filter((child) => child !== file);
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
