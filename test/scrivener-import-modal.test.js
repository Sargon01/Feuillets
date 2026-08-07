import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { ScrivenerFileMap, readAllEntriesFromDirectory } from "../src/ui/scrivener-import-modal.js";

test("ScrivenerFileMap.fromZip : archive avec dossier racine Projet.scriv/...", async () => {
  const zip = new JSZip();
  zip.file(
    "MonProjet.scriv/project.scrivx",
    "<ScrivenerProject><Binder><Folder Type='DraftFolder'><Title>Draft</Title><Children><ScrivenerItem UUID='123' Type='Text'><Title>Scène 1</Title></ScrivenerItem></Children></Folder></Binder></ScrivenerProject>"
  );
  zip.file("MonProjet.scriv/Files/Data/123/content.rtf", "{\\rtf1 Premier chapitre}");
  zip.file("MonProjet.scriv/Files/Data/123/synopsis.txt", "Résumé de la scène 1");

  const buf = await zip.generateAsync({ type: "arraybuffer" });
  const map = await ScrivenerFileMap.fromZip(buf);

  assert.equal(map.scrivxName, "project.scrivx");
  assert.ok(map.topLevelEntries.includes("project.scrivx"));
  assert.ok(map.topLevelEntries.includes("Files"));
  assert.equal(await map.readText("project.scrivx"), await zip.file("MonProjet.scriv/project.scrivx").async("string"));
  assert.equal(await map.readText("Files/Data/123/content.rtf"), "{\\rtf1 Premier chapitre}");
  assert.equal(await map.readText("Files/Data/123/synopsis.txt"), "Résumé de la scène 1");
});

test("ScrivenerFileMap.fromZip : archive sans dossier racine", async () => {
  const zip = new JSZip();
  zip.file(
    "project.scrivx",
    "<ScrivenerProject><Binder><Folder Type='DraftFolder'><Title>Draft</Title></Folder></Binder></ScrivenerProject>"
  );
  zip.file("Files/Data/456/content.rtf", "{\\rtf1 Autre texte}");

  const buf = await zip.generateAsync({ type: "arraybuffer" });
  const map = await ScrivenerFileMap.fromZip(buf);

  assert.equal(map.scrivxName, "project.scrivx");
  assert.ok(map.topLevelEntries.includes("project.scrivx"));
  assert.ok(map.topLevelEntries.includes("Files"));
  assert.equal(await map.readText("Files/Data/456/content.rtf"), "{\\rtf1 Autre texte}");
});

test("ScrivenerFileMap.fromEntries : Drag & drop direct d'un paquet .scriv via HTML5 File Entries", async () => {
  class FakeFile {
    constructor(name, content) {
      this.name = name;
      this._content = content;
    }
    async text() { return this._content; }
    async arrayBuffer() { return new TextEncoder().encode(this._content).buffer; }
  }

  const entries = [
    { relativePath: "MonRoman.scriv/project.scrivx", file: new FakeFile("project.scrivx", "<ScrivenerProject><Binder></Binder></ScrivenerProject>") },
    { relativePath: "MonRoman.scriv/Files/Data/789/content.rtf", file: new FakeFile("content.rtf", "{\\rtf1 Scène déposée}") },
    { relativePath: "MonRoman.scriv/Files/Data/789/synopsis.txt", file: new FakeFile("synopsis.txt", "Synopsis déposé") },
    { relativePath: "MonRoman.scriv/Files/Data/789/photo.jpg", file: new FakeFile("photo.jpg", "bytes") },
  ];

  const map = ScrivenerFileMap.fromEntries(entries);

  assert.equal(map.scrivxName, "project.scrivx");
  assert.ok(map.topLevelEntries.includes("project.scrivx"));
  assert.ok(map.topLevelEntries.includes("Files"));
  assert.equal(await map.readText("Files/Data/789/content.rtf"), "{\\rtf1 Scène déposée}");
  assert.equal(await map.readText("Files/Data/789/synopsis.txt"), "Synopsis déposé");

  const images = map.findAttachedDataImages("789");
  assert.equal(images.length, 1);
  assert.equal(images[0].fileName, "photo.jpg");
  assert.ok(await images[0].readArrayBuffer() instanceof ArrayBuffer);
});

test("ScrivenerFileMap : paquet invalide sans .scrivx", async () => {
  const map = ScrivenerFileMap.fromEntries([
    { relativePath: "Random/readme.txt", file: { text: async () => "no scrivx" } },
  ]);

  assert.equal(map.scrivxName, null);
  assert.deepEqual(map.topLevelEntries, []);
});

test("ScrivenerFileMap : webkitGetAsEntry lecture récursive d'un réperteoire mock", async () => {
  class FakeFileEntry {
    constructor(name) {
      this.name = name;
      this.isFile = true;
      this.isDirectory = false;
    }
    file(cb) {
      cb({ name: this.name, text: async () => "content", arrayBuffer: async () => new ArrayBuffer(0) });
    }
  }

  class FakeDirEntry {
    constructor(name, children) {
      this.name = name;
      this.isFile = false;
      this.isDirectory = true;
      this.children = children;
    }
    createReader() {
      let read = false;
      return {
        readEntries: (cb) => {
          if (!read) {
            read = true;
            cb(this.children);
          } else {
            cb([]);
          }
        },
      };
    }
  }

  const mockDir = new FakeDirEntry("Roman.scriv", [
    new FakeFileEntry("project.scrivx"),
    new FakeDirEntry("Files", [
      new FakeDirEntry("Data", [
        new FakeFileEntry("content.rtf"),
      ]),
    ]),
  ]);

  const results = await readAllEntriesFromDirectory(mockDir);
  assert.equal(results.length, 2);
  assert.equal(results[0].relativePath, "project.scrivx");
  assert.equal(results[1].relativePath, "Files/Data/content.rtf");

  const map = ScrivenerFileMap.fromEntries(results);
  assert.equal(map.scrivxName, "project.scrivx");
  assert.equal(await map.readText("Files/Data/content.rtf"), "content");
});

// ============================ Lot S3 : finaliser et sécuriser l'import =====

function buildFixtureMap(files) {
  const entries = Object.entries(files).map(([relativePath, content]) => ({
    relativePath: `Projet.scriv/${relativePath}`,
    file: {
      text: async () => content,
      arrayBuffer: async () => new TextEncoder().encode(content).buffer,
    },
  }));
  return ScrivenerFileMap.fromEntries(entries);
}

test("§11 chantier S3 — 17. findScrivenerFileByRef : rawRef exact résolu vers la bonne source", async () => {
  const map = buildFixtureMap({
    "project.scrivx": "<ScrivenerProject><Binder></Binder></ScrivenerProject>",
    "Images/A/photo.jpg": "bytes-A",
    "Images/B/photo.jpg": "bytes-B",
  });

  const foundA = map.findScrivenerFileByRef("Images/A/photo.jpg");
  assert.ok(foundA);
  assert.equal(foundA.fileName, "photo.jpg");
  assert.equal(new TextDecoder().decode(await foundA.readArrayBuffer()), "bytes-A");

  const foundB = map.findScrivenerFileByRef("Images/B/photo.jpg");
  assert.ok(foundB);
  assert.equal(new TextDecoder().decode(await foundB.readArrayBuffer()), "bytes-B");
});

test("§11 chantier S3 — findScrivenerFileByRef normalise les antislashs et un éventuel / initial", async () => {
  const map = buildFixtureMap({
    "project.scrivx": "<ScrivenerProject><Binder></Binder></ScrivenerProject>",
    "Images/A/photo.jpg": "bytes-A",
  });
  const found = map.findScrivenerFileByRef("\\Images\\A\\photo.jpg");
  assert.ok(found);
  assert.equal(new TextDecoder().decode(await found.readArrayBuffer()), "bytes-A");
  const foundLeadingSlash = map.findScrivenerFileByRef("/Images/A/photo.jpg");
  assert.ok(foundLeadingSlash);
});

test("§11 chantier S3 — findScrivenerFileByRef : référence inexistante -> null (jamais un repli implicite)", async () => {
  const map = buildFixtureMap({
    "project.scrivx": "<ScrivenerProject><Binder></Binder></ScrivenerProject>",
    "Images/A/photo.jpg": "bytes-A",
  });
  assert.equal(map.findScrivenerFileByRef("Images/C/photo.jpg"), null);
});

test("§12 chantier S3 — 18. findScrivenerFilesByBasename : un seul candidat -> repli accepté", async () => {
  const map = buildFixtureMap({
    "project.scrivx": "<ScrivenerProject><Binder></Binder></ScrivenerProject>",
    "Images/A/unique.png": "bytes",
  });
  const candidates = map.findScrivenerFilesByBasename("unique.png");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].fileName, "unique.png");
});

test("§12 chantier S3 — 19. findScrivenerFilesByBasename : basename absent -> aucun candidat", async () => {
  const map = buildFixtureMap({
    "project.scrivx": "<ScrivenerProject><Binder></Binder></ScrivenerProject>",
  });
  assert.deepEqual(map.findScrivenerFilesByBasename("absent.png"), []);
});

test("§12 chantier S3 — 20. findScrivenerFilesByBasename : deux candidats de même basename -> tous deux renvoyés, aucun choix arbitraire", async () => {
  const map = buildFixtureMap({
    "project.scrivx": "<ScrivenerProject><Binder></Binder></ScrivenerProject>",
    "Images/A/photo.jpg": "bytes-A",
    "Images/B/photo.jpg": "bytes-B",
  });
  const candidates = map.findScrivenerFilesByBasename("photo.jpg");
  assert.equal(candidates.length, 2, "ambiguïté : les deux candidats doivent être visibles, pas un seul choisi au hasard");
});

test("§15/§30 chantier S3 — 8/9. listAttachedDataFiles : fichiers techniques jamais signalés, ressource reconnue = supported", async () => {
  const map = buildFixtureMap({
    "project.scrivx": "<ScrivenerProject><Binder></Binder></ScrivenerProject>",
    "Files/Data/UUID-1/content.rtf": "rtf",
    "Files/Data/UUID-1/notes.rtf": "rtf",
    "Files/Data/UUID-1/synopsis.txt": "txt",
    "Files/Data/UUID-1/content.comments": "xml",
    "Files/Data/UUID-1/photo.jpg": "bytes",
  });
  const files = map.listAttachedDataFiles("UUID-1");
  const byName = Object.fromEntries(files.map((f) => [f.fileName, f.kind]));
  assert.equal(byName["content.rtf"], "controlFile");
  assert.equal(byName["notes.rtf"], "controlFile");
  assert.equal(byName["synopsis.txt"], "controlFile");
  assert.equal(byName["content.comments"], "controlFile");
  assert.equal(byName["photo.jpg"], "supported");
});

test("§15/§30 chantier S3 — 29. listAttachedDataFiles : mp3/mov détectés comme non pris en charge (BinderItem Media)", async () => {
  const map = buildFixtureMap({
    "project.scrivx": "<ScrivenerProject><Binder></Binder></ScrivenerProject>",
    "Files/Data/UUID-1/audio.mp3": "bytes",
    "Files/Data/UUID-1/clip.mov": "bytes",
  });
  const files = map.listAttachedDataFiles("UUID-1");
  const byName = Object.fromEntries(files.map((f) => [f.fileName, f.kind]));
  assert.equal(byName["audio.mp3"], "unsupported");
  assert.equal(byName["clip.mov"], "unsupported");
});

test("§15 chantier S3 — listAttachedDataFiles : un UUID sans fichier attaché renvoie une liste vide", async () => {
  const map = buildFixtureMap({
    "project.scrivx": "<ScrivenerProject><Binder></Binder></ScrivenerProject>",
    "Files/Data/UUID-1/photo.jpg": "bytes",
  });
  assert.deepEqual(map.listAttachedDataFiles("UUID-INCONNU"), []);
});
