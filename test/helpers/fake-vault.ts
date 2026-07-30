import { TFile, TFolder, normalizePath, type TAbstractFile } from "obsidian";

/* TFile/TFolder n'ont, côté types Obsidian (obsidian.d.ts), aucun
   constructeur public déclaré (0 argument hérité de TAbstractFile) — ils
   sont normalement instanciés par le coffre réel, jamais par du code de
   plugin. Le stub de test (test/obsidian-runtime-stub.mjs), substitué au
   module "obsidian" à l'exécution, leur donne au contraire un vrai
   constructeur (path, content) / (path, children) pour fabriquer un
   coffre en mémoire. On type donc ce constructeur réel ici via une
   assertion précise, plutôt que de mentir sur le type public de TFile. */
type FakeTFile = TFile & { content: string };
type TFileCtor = new (path: string, content?: string) => FakeTFile;
type TFolderCtor = new (path: string, children?: TAbstractFile[]) => TFolder;
const FakeTFile = TFile as unknown as TFileCtor;
const FakeTFolder = TFolder as unknown as TFolderCtor;

type FakeVaultEntry = FakeTFile | TFolder;
type Frontmatter = Record<string, string>;

export function createFakeVault(entries: FakeVaultEntry[] = []) {
  const files = new Map<string, FakeVaultEntry>();
  for (const entry of entries) files.set(entry.path, entry);

  const parentFolder = (path: string) => files.get(normalizePath(path).split("/").slice(0, -1).join("/"));
  const addFile = (path: string, content: string): FakeTFile => {
    const file = new FakeTFile(normalizePath(path), content);
    file.parent = (parentFolder(file.path) as TFolder) || null;
    file.stat = { mtime: Date.now() } as FakeTFile["stat"];
    files.set(file.path, file);
    if (file.parent?.children) file.parent.children.push(file);
    return file;
  };

  const vault = {
    getAbstractFileByPath(path: string): FakeVaultEntry | null {
      return files.get(normalizePath(path)) || null;
    },
    async read(file: FakeTFile): Promise<string> {
      return file.content || "";
    },
    async create(path: string, content: string): Promise<FakeTFile> {
      return addFile(path, content);
    },
    async copy(file: FakeTFile, path: string): Promise<FakeTFile> {
      return addFile(path, file.content || "");
    },
    async createFolder(path: string): Promise<TFolder> {
      const folder = new FakeTFolder(normalizePath(path));
      folder.parent = (parentFolder(folder.path) as TFolder) || null;
      files.set(folder.path, folder);
      if (folder.parent?.children) folder.parent.children.push(folder);
      return folder;
    },
    async modify(file: FakeTFile, content: string): Promise<void> {
      file.content = content;
    },
    async readBinary(file: FakeTFile): Promise<string> {
      return file.content || "";
    },
    async createBinary(path: string, content: string): Promise<FakeTFile> {
      return addFile(path, content);
    },
    async delete(file: FakeTFile): Promise<void> {
      files.delete(file.path);
      if (file.parent?.children) {
        file.parent.children = file.parent.children.filter((child) => child !== file);
      }
    },
  };

  const fileManager = {
    async renameFile(file: FakeTFile, path: string): Promise<void> {
      files.delete(file.path);
      file.path = normalizePath(path);
      file.name = file.path.split("/").pop()!;
      file.basename = file.name.replace(/\.md$/, "");
      files.set(file.path, file);
    },
    async processFrontMatter(file: FakeTFile, callback: (frontmatter: Frontmatter) => void): Promise<void> {
      const match = (file.content || "").match(/^---\n([\s\S]*?)\n---\n?/);
      const frontmatter: Frontmatter = {};
      for (const line of match?.[1].split("\n") || []) {
        const [key, value = ""] = line.split(/:\s*/, 2);
        if (key) frontmatter[key] = value;
      }
      callback(frontmatter);
    },
  };

  return { vault, fileManager, files, TFolder };
}
