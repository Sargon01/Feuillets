/** Construit une arborescence de tags à partir d'une liste de fichiers et
 * de leurs tags (`#parent/enfant` devient un nœud imbriqué, comme le
 * panneau Tags natif d'Obsidian). Fonction pure : ne connaît ni l'app ni
 * le vault, juste des chemins de fichiers en chaînes de caractères.
 *
 * `filesWithTags`: [{ path: string, tags: string[] }]
 * Retourne une Map<nomDuNœud, node> où
 *   node = { name, fullPath, files: Set<path>, children: Map }
 * `files` contient les chemins des fichiers tagués EXACTEMENT à ce
 * niveau (pas ceux des descendants — voir `collectFiles` pour l'agrégat).
 */
type TagNode = {
  name: string;
  fullPath: string;
  files: Set<string>;
  children: Map<string, TagNode>;
};

type FileWithTags = {
  path: string;
  tags: string[];
};

export function buildTagTree(filesWithTags: FileWithTags[]) {
  const root = new Map<string, TagNode>();

  const getOrCreate = (map: Map<string, TagNode>, name: string, fullPath: string) => {
    if (!map.has(name)) {
      map.set(name, { name, fullPath, files: new Set(), children: new Map() });
    }
    return map.get(name)!;
  };

  for (const { path, tags } of filesWithTags) {
    for (const tag of tags) {
      const parts = String(tag).trim().split("/").map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) continue;
      let map = root;
      let fullPath = "";
      let node: TagNode | null = null;
      for (const part of parts) {
        fullPath = fullPath ? `${fullPath}/${part}` : part;
        const nextNode = getOrCreate(map, part, fullPath);
        node = nextNode;
        map = nextNode.children;
      }
      if (node) node.files.add(path);
    }
  }
  return root;
}

/** Chemins de fichiers uniques portés par un nœud ET tous ses descendants
 * — c'est le compte affiché à côté d'un tag parent (comme Obsidian). */
export function collectFiles(node: TagNode) {
  const files = new Set(node.files);
  for (const child of node.children.values()) {
    for (const f of collectFiles(child)) files.add(f);
  }
  return files;
}

/** Nœuds d'une Map triés alphabétiquement (fr) — même convention que le
 * reste du plugin. */
export function sortTagNodes(map: Map<string, TagNode>) {
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
