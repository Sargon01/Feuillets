import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveBibliographyMetadata,
  resolveBibliographyMetadataFromFrontmatter,
} from "../src/services/source-bibliography-resolver.js";

// Mock objects for testing
const createMockFile = (_frontmatter) => ({
  path: "test/file.md",
  stat: { mtime: 0, size: 100 },
  basename: "file.md",
  name: "file",
  parent: null,
});

const createMockApp = (frontmatter) => {
  // Mock app with Obsidian metadataCache interface
  return {
    metadataCache: {
      getFileCache: () => ({
        frontmatter: frontmatter,
      }),
    },
  };
};

test("1. native author is prioritized", () => {
  const frontmatter = {
    author: "Native Author",
    creator: "Legacy Creator",
    creators: ["Creator One", "Creator Two"],
  };
  const app = createMockApp(frontmatter);
  const file = createMockFile(frontmatter);

  const result = resolveBibliographyMetadata(app, file);
  assert.equal(result.author, "Native Author");
});

test("2. French alias for author", () => {
  const frontmatter = {
    auteur: "Jean Dupont",
  };
  const app = createMockApp(frontmatter);
  const file = createMockFile(frontmatter);

  const result = resolveBibliographyMetadata(app, file);
  assert.equal(result.author, "Jean Dupont");
});

test("3. singular creator", () => {
  const frontmatter = {
    creator: "Jane Doe",
  };
  const app = createMockApp(frontmatter);
  const file = createMockFile(frontmatter);

  const result = resolveBibliographyMetadata(app, file);
  assert.equal(result.author, "Jane Doe");
});

test("4. ZotFlow creators array", () => {
  const frontmatter = {
    creators: ["Jane Doe", "John Smith"],
  };
  const app = createMockApp(frontmatter);
  const file = createMockFile(frontmatter);

  const result = resolveBibliographyMetadata(app, file);
  assert.equal(result.author, "Jane Doe, John Smith");
});

test("5. ZotFlow publication", () => {
  const frontmatter = {
    publication: "Historical Review",
  };
  const app = createMockApp(frontmatter);
  const file = createMockFile(frontmatter);

  const result = resolveBibliographyMetadata(app, file);
  assert.equal(result.publisher, "Historical Review");
});

test("6. publisher priority over publication", () => {
  const frontmatter = {
    publisher: "Native Publisher",
    publication: "ZotFlow Publication",
  };
  const app = createMockApp(frontmatter);
  const file = createMockFile(frontmatter);

  const result = resolveBibliographyMetadata(app, file);
  assert.equal(result.publisher, "Native Publisher");
});

test("7. numeric year", () => {
  const frontmatter = {
    year: 2024,
  };
  const app = createMockApp(frontmatter);
  const file = createMockFile(frontmatter);

  const result = resolveBibliographyMetadata(app, file);
  assert.equal(result.date, "2024");
});

test("8. complete ZotFlow entry", () => {
  const frontmatter = {
    title: "A Study",
    creators: ["Jane Doe", "John Smith"],
    publication: "Historical Review",
    year: 2024,
    url: "https://example.org",
  };
  const app = createMockApp(frontmatter);
  const file = createMockFile(frontmatter);

  const result = resolveBibliographyMetadata(app, file);
  assert.equal(result.author, "Jane Doe, John Smith");
  assert.equal(result.title, "A Study");
  assert.equal(result.publisher, "Historical Review");
  assert.equal(result.date, "2024");
  assert.equal(result.url, "https://example.org");
});

test("9. unsupported object value is ignored", () => {
  const frontmatter = {
    author: { firstName: "Jane", lastName: "Doe" },
    creator: "Fallback Author",
  };
  const app = createMockApp(frontmatter);
  const file = createMockFile(frontmatter);

  const result = resolveBibliographyMetadata(app, file);
  // Object is rejected, falls through to creator
  assert.equal(result.author, "Fallback Author");
});

test("10. empty strings are ignored", () => {
  const frontmatter = {
    author: "",
    auteur: "Jean Dupont",
  };
  const app = createMockApp(frontmatter);
  const file = createMockFile(frontmatter);

  const result = resolveBibliographyMetadata(app, file);
  assert.equal(result.author, "Jean Dupont");
});

test("11. null and undefined are ignored", () => {
  const frontmatter = {
    author: null,
    auteur: "Jean Dupont",
  };
  const app = createMockApp(frontmatter);
  const file = createMockFile(frontmatter);

  const result = resolveBibliographyMetadata(app, file);
  assert.equal(result.author, "Jean Dupont");
});

test("12. title fallback", () => {
  const frontmatter = {
    titre: "Mon Titre",
  };
  const app = createMockApp(frontmatter);
  const file = createMockFile(frontmatter);

  const result = resolveBibliographyMetadata(app, file);
  assert.equal(result.title, "Mon Titre");
});

test("13. author array", () => {
  const frontmatter = {
    author: ["Jane Doe", "John Smith"],
  };
  const result = resolveBibliographyMetadataFromFrontmatter(frontmatter);
  assert.equal(result.author, "Jane Doe, John Smith");
});

test("14. auteur array (French)", () => {
  const frontmatter = {
    auteur: ["Jean Dupont", "Marie Martin"],
  };
  const result = resolveBibliographyMetadataFromFrontmatter(frontmatter);
  assert.equal(result.author, "Jean Dupont, Marie Martin");
});

test("15. author array takes priority over creators", () => {
  const frontmatter = {
    author: ["Native One", "Native Two"],
    creators: ["ZotFlow One", "ZotFlow Two"],
  };
  const result = resolveBibliographyMetadataFromFrontmatter(frontmatter);
  assert.equal(result.author, "Native One, Native Two");
});

test("16. creator array (singular field)", () => {
  const frontmatter = {
    creator: ["Jane Doe", "John Smith"],
  };
  const result = resolveBibliographyMetadataFromFrontmatter(frontmatter);
  assert.equal(result.author, "Jane Doe, John Smith");
});

test("17. mixed array with null, empty strings, and objects", () => {
  const frontmatter = {
    creators: ["Jane Doe", null, {}, "John Smith", "", undefined, 42],
  };
  const result = resolveBibliographyMetadataFromFrontmatter(frontmatter);
  assert.equal(result.author, "Jane Doe, John Smith, 42");
});

test("18. empty array returns undefined", () => {
  const frontmatter = {
    creators: [],
  };
  const result = resolveBibliographyMetadataFromFrontmatter(frontmatter);
  assert.equal(result.author, undefined);
});

test("19. array of all nulls returns undefined", () => {
  const frontmatter = {
    creators: [null, undefined, ""],
  };
  const result = resolveBibliographyMetadataFromFrontmatter(frontmatter);
  assert.equal(result.author, undefined);
});
