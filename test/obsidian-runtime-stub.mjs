export function setIcon() {}

export class TFile {
  constructor(path, content = "") {
    this.path = path;
    this.name = path.split("/").pop();
    this.basename = this.name.replace(/\.md$/, "");
    this.extension = this.name.split(".").pop();
    this.content = content;
  }
}

export class TFolder {
  constructor(path, children = []) {
    this.path = path;
    this.name = path.split("/").pop();
    this.children = children;
    this.parent = null;
  }
}

export class Notice {
  constructor(message) {
    this.message = message;
  }
}

export class Modal {}

export function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\//, "");
}
