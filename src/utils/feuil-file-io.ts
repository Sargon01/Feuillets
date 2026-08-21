function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function isPortableFeuilNameSegment(value: string): boolean {
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || hasControlCharacter(value) || /[<>:"|?*]/.test(value) || value.endsWith(".") || value.endsWith(" ")) return false;
  const baseName = value.split(".", 1)[0].toUpperCase();
  return !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(baseName);
}

export function sanitizeFeuilFileStem(value: string): string {
  let cleaned = "";
  for (const character of value.replace(/\.feuil$/i, "")) cleaned += hasControlCharacter(character) ? "" : character;
  let stem = cleaned.replace(/[\\/:*?"<>|]/g, "-").trim().replace(/[. ]+$/, "");
  if (!stem || stem === "." || stem === ".." || !isPortableFeuilNameSegment(stem)) stem = "Projet";
  return stem;
}

export function feuilDownloadName(label: string): string {
  return `${sanitizeFeuilFileStem(label)}.feuil`;
}

export function downloadFeuilArchive(data: Uint8Array, filename: string): void {
  const copy = new Uint8Array(data.byteLength); copy.set(data);
  const url = URL.createObjectURL(new Blob([copy], { type: "application/octet-stream" }));
  const link = document.body.createEl("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
